package me.maxistar.keyboardhelper.layouts

import android.app.Activity
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.UUID

private const val MAX_JSON_IMPORT_BYTES = 524_288
private const val MAX_RECORDS = 128
private const val MAX_NAME_LENGTH = 80
private const val LEGACY_RECORD_SCHEMA_VERSION = 1
private const val RECORD_SCHEMA_VERSION = 2
private const val SELECTION_SCHEMA_VERSION = 1
private val RECORD_ID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
private val TRANSACTION_ID = RECORD_ID
private val DIGEST = Regex("^[0-9a-f]{64}$")

@InvokeArg
class StoredAssetArgs {
    lateinit var path: String
    lateinit var mimeType: String
    var sizeBytes: Int = 0
    var width: Int = 0
    var height: Int = 0
    lateinit var digest: String
}

@InvokeArg
class StoredRecordArgs {
    var schemaVersion: Int = 0
    lateinit var id: String
    lateinit var name: String
    lateinit var normalizedName: String
    lateinit var digest: String
    lateinit var content: String
    var format: String? = null
    var assets: Array<StoredAssetArgs> = emptyArray()
}

@InvokeArg class CommitPackageArgs { lateinit var token: String; lateinit var record: StoredRecordArgs }
@InvokeArg class TokenArgs { lateinit var token: String }
@InvokeArg class RemoveRecordArgs { lateinit var id: String }
@InvokeArg class ReadAssetArgs { lateinit var id: String; lateinit var path: String }
@InvokeArg class SelectionArgs { var schemaVersion: Int = 0; lateinit var source: String; lateinit var id: String }

internal class LayoutStorageException(val code: String, message: String) : Exception(message)

@TauriPlugin
class KeyboardHelperLayoutsPlugin(private val activity: Activity) : Plugin(activity) {
    private val store = LayoutRecordStore(activity.filesDir)
    private val legacyRecordsDirectory get() = store.legacyRecordsDirectory
    private val packageRecordsDirectory get() = store.packageRecordsDirectory
    private val stagingDirectory get() = store.stagingDirectory
    private val selectionFile get() = store.selectionFile
    private val prepared = mutableMapOf<String, PreparedLayoutPackage>()
    private var pickerActive = false

    @Command
    fun pickLayout(invoke: Invoke) {
        if (pickerActive) { invoke.reject("A layout picker is already open.", "picker-busy"); return }
        pickerActive = true
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json", "text/json", "text/plain", "application/zip", "application/octet-stream"))
        }
        try { startActivityForResult(invoke, intent, "layoutPickerResult") }
        catch (error: Exception) { pickerActive = false; invoke.reject("The Android document picker could not be opened.", "picker-unavailable", error) }
    }

    @ActivityCallback
    fun layoutPickerResult(invoke: Invoke, result: ActivityResult) {
        pickerActive = false
        if (result.resultCode == Activity.RESULT_CANCELED) { invoke.resolve(JSObject().put("cancelled", true)); return }
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) { invoke.reject("Android did not return a readable layout document.", "picker-failed"); return }
        try {
            val bytes = readBounded(uri, MAX_PACKAGE_BYTES)
            val response = if (isZip(bytes)) preparePackage(bytes) else prepareJson(bytes)
            response.put("cancelled", false).put("displayName", displayName(uri)).put("sizeBytes", bytes.size)
            invoke.resolve(response)
        } catch (error: LayoutStorageException) { invoke.reject(error.message, error.code) }
        catch (error: Exception) { invoke.reject("The selected layout could not be read.", "document-unreadable", error) }
    }

    @Command
    fun listRecords(invoke: Invoke) {
        val records = JSONArray(); val diagnostics = JSONArray()
        try {
            val packages = packageRecordsDirectory.listFiles { file -> file.isDirectory && RECORD_ID.matches(file.name) }?.sortedBy { it.name } ?: emptyList()
            val packageIds = packages.mapTo(mutableSetOf()) { it.name }
            for (directory in packages.take(MAX_RECORDS)) {
                try {
                    val record = readRecord(File(directory, "record.json")); validateRecord(record, "package")
                    validateStoredPackage(record, LayoutPackageSupport.inspectDirectory(directory)); records.put(record)
                } catch (_: Exception) { diagnostics.put("A stored package layout was skipped because its content or image assets are invalid.") }
            }
            val legacy = legacyRecordsDirectory.listFiles { file -> file.isFile && file.extension == "json" && file.nameWithoutExtension !in packageIds }?.sortedBy { it.name } ?: emptyList()
            for (file in legacy.take((MAX_RECORDS - records.length()).coerceAtLeast(0))) {
                try { val record = readRecord(file); validateRecord(record, "json"); records.put(record) }
                catch (_: Exception) { diagnostics.put("A stored custom layout was skipped because it is unreadable or unsupported.") }
            }
            if (packages.size + legacy.size > MAX_RECORDS) diagnostics.put("Additional custom layouts were skipped because the catalog limit is 128.")
            invoke.resolve(JSObject().put("records", records).put("diagnostics", diagnostics))
        } catch (error: Exception) { invoke.reject("Custom layouts could not be loaded.", "storage-unavailable", error) }
    }

    @Command
    fun writeRecord(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(StoredRecordArgs::class.java); val record = recordJson(args)
            validateRecord(record, "json"); enforceCatalogCapacity(args.id)
            store.writeAtomic(legacyRecordFile(args.id), record.toString().toByteArray(StandardCharsets.UTF_8))
            packageRecordDirectory(args.id).deleteRecursively(); invoke.resolve()
        } catch (error: LayoutStorageException) { invoke.reject(error.message, error.code) }
        catch (error: Exception) { invoke.reject("The custom layout could not be saved.", "storage-write-failed", error) }
    }

    @Command
    fun commitPackage(invoke: Invoke) {
        var transaction: PreparedLayoutPackage? = null
        try {
            val args = invoke.parseArgs(CommitPackageArgs::class.java); validateToken(args.token)
            transaction = synchronized(prepared) { prepared.remove(args.token) }
                ?: throw LayoutStorageException("package-token-invalid", "The prepared layout package is no longer available.")
            val record = recordJson(args.record); validateRecord(record, "package"); validateStoredPackage(record, transaction)
            enforceCatalogCapacity(args.record.id)
            store.commitPackage(args.token, args.record.id, transaction.directory, record.toString().toByteArray(StandardCharsets.UTF_8))
            legacyRecordFile(args.record.id).delete(); invoke.resolve()
        } catch (error: LayoutStorageException) { transaction?.directory?.deleteRecursively(); invoke.reject(error.message, error.code) }
        catch (error: Exception) { transaction?.directory?.deleteRecursively(); invoke.reject("The layout package could not be saved.", "package-commit-failed", error) }
    }

    @Command
    fun discardPackage(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(TokenArgs::class.java); validateToken(args.token)
            synchronized(prepared) { prepared.remove(args.token) }?.directory?.deleteRecursively(); invoke.resolve()
        } catch (error: LayoutStorageException) { invoke.reject(error.message, error.code) }
    }

    @Command
    fun readAsset(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(ReadAssetArgs::class.java); val directory = packageRecordDirectory(args.id)
            val record = readRecord(File(directory, "record.json")); validateRecord(record, "package")
            val path = LayoutPackageSupport.normalizeAssetPath(args.path)
            val descriptor = record.optJSONArray("assets")?.let { array ->
                (0 until array.length()).map { array.getJSONObject(it) }.find { it.optString("path") == path }
            } ?: throw LayoutStorageException("asset-not-owned", "The requested image is not owned by this layout.")
            val file = File(directory, path)
            if (!file.isFile || file.length() != descriptor.optLong("sizeBytes") || file.length() !in 1..MAX_PACKAGE_IMAGE_BYTES.toLong()) throw LayoutStorageException("asset-unavailable", "The requested layout image is unavailable.")
            val bytes = file.readBytes()
            if (sha256(bytes) != descriptor.optString("digest")) throw LayoutStorageException("asset-unavailable", "The requested layout image failed verification.")
            invoke.resolve(JSObject().put("mimeType", descriptor.optString("mimeType")).put("bytes", JSONArray(bytes.map { it.toInt() and 0xff })))
        } catch (error: LayoutStorageException) { invoke.reject(error.message, error.code) }
        catch (error: Exception) { invoke.reject("The requested layout image could not be read.", "asset-unavailable", error) }
    }

    @Command
    fun removeRecord(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(RemoveRecordArgs::class.java); validateId(args.id)
            store.removeRecord(args.id)
            invoke.resolve()
        } catch (error: LayoutStorageException) { invoke.reject(error.message, error.code) }
        catch (error: Exception) { invoke.reject("The custom layout could not be removed.", "storage-remove-failed", error) }
    }

    @Command
    fun readSelection(invoke: Invoke) {
        if (!selectionFile.exists()) { invoke.resolve(JSObject().put("selection", null).put("diagnostic", null)); return }
        try {
            val bytes = selectionFile.readBytes(); if (bytes.size > 1024) throw Exception("oversized preference")
            val selection = JSONObject(String(bytes, StandardCharsets.UTF_8)); validateSelection(selection)
            invoke.resolve(JSObject().put("selection", selection).put("diagnostic", null))
        } catch (_: Exception) { invoke.resolve(JSObject().put("selection", null).put("diagnostic", "The saved layout selection was reset.")) }
    }

    @Command
    fun writeSelection(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SelectionArgs::class.java)
            val selection = JSONObject().put("schemaVersion", args.schemaVersion).put("source", args.source).put("id", args.id)
            validateSelection(selection); store.writeAtomic(selectionFile, selection.toString().toByteArray(StandardCharsets.UTF_8)); invoke.resolve()
        } catch (error: LayoutStorageException) { invoke.reject(error.message, error.code) }
        catch (error: Exception) { invoke.reject("The selected layout could not be saved.", "preference-write-failed", error) }
    }

    private fun prepareJson(bytes: ByteArray): JSObject {
        if (bytes.size > MAX_JSON_IMPORT_BYTES) throw LayoutStorageException("document-too-large", "The selected JSON layout is larger than 512 KiB.")
        val decoder = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        val content = try { decoder.decode(ByteBuffer.wrap(bytes)).toString() } catch (_: Exception) { throw LayoutStorageException("invalid-utf8", "The selected layout is not valid UTF-8.") }
        if (!content.trimStart().startsWith("{")) throw LayoutStorageException("document-format-unsupported", "Choose a JSON layout or .khlayout package.")
        return JSObject().put("kind", "json").put("content", content)
    }

    private fun preparePackage(bytes: ByteArray): JSObject {
        val token = UUID.randomUUID().toString().lowercase(); val result = LayoutPackageSupport.prepare(bytes, File(stagingDirectory, token))
        synchronized(prepared) { prepared[token] = result }
        return JSObject().put("kind", "package").put("token", token).put("content", result.content)
            .put("digest", result.digest).put("assets", LayoutPackageSupport.assetArray(result.assets))
    }

    private fun validateStoredPackage(record: JSONObject, inspected: PreparedLayoutPackage) {
        if (record.optString("content") != inspected.content || record.optString("digest") != inspected.digest) throw LayoutStorageException("invalid-record", "The package record does not match its stored content.")
        val declared = record.optJSONArray("assets") ?: JSONArray()
        if (declared.length() != inspected.assets.size) throw LayoutStorageException("invalid-record", "The package asset inventory is invalid.")
        val expected = inspected.assets.associateBy { it.path }
        repeat(declared.length()) { index ->
            val item = declared.getJSONObject(index); val asset = expected[item.optString("path")] ?: throw LayoutStorageException("invalid-record", "The package asset inventory is invalid.")
            if (item.optString("mimeType") != asset.mimeType || item.optInt("sizeBytes") != asset.sizeBytes || item.optInt("width") != asset.width || item.optInt("height") != asset.height || item.optString("digest") != asset.digest) throw LayoutStorageException("invalid-record", "The package asset inventory is invalid.")
        }
    }

    private fun recordJson(args: StoredRecordArgs): JSONObject = JSONObject()
        .put("schemaVersion", args.schemaVersion).put("id", args.id).put("name", args.name)
        .put("normalizedName", args.normalizedName).put("digest", args.digest).put("content", args.content)
        .put("format", args.format ?: JSONObject.NULL).put("assets", JSONArray().also { array -> args.assets.forEach { asset ->
            array.put(JSONObject().put("path", asset.path).put("mimeType", asset.mimeType).put("sizeBytes", asset.sizeBytes)
                .put("width", asset.width).put("height", asset.height).put("digest", asset.digest))
        } })

    private fun validateRecord(value: JSONObject, expectedFormat: String) {
        val version = value.optInt("schemaVersion"); val format = value.optString("format")
        if (expectedFormat == "json" && version !in setOf(LEGACY_RECORD_SCHEMA_VERSION, RECORD_SCHEMA_VERSION)) throw LayoutStorageException("unsupported-record", "The custom layout record version is unsupported.")
        if (expectedFormat == "package" && (version != RECORD_SCHEMA_VERSION || format != "package")) throw LayoutStorageException("unsupported-record", "The package record version is unsupported.")
        if (expectedFormat == "json" && version == RECORD_SCHEMA_VERSION && format != "json") throw LayoutStorageException("invalid-record", "The custom layout format is invalid.")
        validateId(value.optString("id")); val name = value.optString("name"); val normalizedName = value.optString("normalizedName"); val content = value.optString("content")
        if (name.isBlank() || name.length > MAX_NAME_LENGTH || normalizedName.isBlank() || normalizedName.length > MAX_NAME_LENGTH) throw LayoutStorageException("invalid-record", "The custom layout name is invalid.")
        if (!DIGEST.matches(value.optString("digest")) || content.toByteArray(StandardCharsets.UTF_8).size > MAX_PACKAGE_TEXT_BYTES) throw LayoutStorageException("invalid-record", "The custom layout record is invalid.")
    }

    private fun enforceCatalogCapacity(id: String) {
        val ids = mutableSetOf<String>()
        legacyRecordsDirectory.listFiles { file -> file.isFile && file.extension == "json" }?.forEach { ids.add(it.nameWithoutExtension) }
        packageRecordsDirectory.listFiles { file -> file.isDirectory && RECORD_ID.matches(file.name) }?.forEach { ids.add(it.name) }
        if (id !in ids && ids.size >= MAX_RECORDS) throw LayoutStorageException("catalog-full", "The custom layout limit is 128.")
    }

    private fun readRecord(file: File): JSONObject { if (!file.isFile || file.length() !in 1..(MAX_PACKAGE_TEXT_BYTES * 2L)) throw Exception("invalid record file"); return JSONObject(String(file.readBytes(), StandardCharsets.UTF_8)) }
    private fun legacyRecordFile(id: String): File { validateId(id); return store.legacyRecordFile(id) }
    private fun packageRecordDirectory(id: String): File { validateId(id); return store.packageRecordDirectory(id) }
    private fun validateId(id: String) { if (!RECORD_ID.matches(id)) throw LayoutStorageException("invalid-record", "The custom layout identity is invalid.") }
    private fun validateToken(token: String) { if (!TRANSACTION_ID.matches(token)) throw LayoutStorageException("package-token-invalid", "The package transaction is invalid.") }

    private fun validateSelection(value: JSONObject) {
        if (value.optInt("schemaVersion") != SELECTION_SCHEMA_VERSION) throw LayoutStorageException("unsupported-preference", "The saved selection version is unsupported.")
        val source = value.optString("source"); val id = value.optString("id")
        if (source !in setOf("bundled", "custom") || id.isBlank() || id.length > 128 || (source == "custom" && !RECORD_ID.matches(id))) throw LayoutStorageException("invalid-preference", "The saved layout selection is invalid.")
    }

    private fun readBounded(uri: Uri, limit: Int): ByteArray = activity.contentResolver.openInputStream(uri)?.use { input ->
        val output = ByteArrayOutputStream(); val buffer = ByteArray(8192)
        while (true) { val read = input.read(buffer); if (read < 0) break; if (output.size() + read > limit) throw LayoutStorageException("document-too-large", "The selected document is larger than 2 MiB."); output.write(buffer, 0, read) }
        output.toByteArray()
    } ?: throw LayoutStorageException("document-unreadable", "The selected layout could not be opened.")

    private fun isZip(bytes: ByteArray): Boolean = bytes.size >= 4 && bytes[0] == 0x50.toByte() && bytes[1] == 0x4b.toByte() && bytes[2] == 0x03.toByte() && bytes[3] == 0x04.toByte()
    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun displayName(uri: Uri): String? {
        var cursor: Cursor? = null
        return try { cursor = activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null); if (cursor != null && cursor.moveToFirst()) cursor.getString(0)?.take(120) else null }
        catch (_: Exception) { null } finally { cursor?.close() }
    }
}
