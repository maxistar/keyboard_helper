package me.maxistar.keyboardhelper.layouts

import android.app.Activity
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import android.util.AtomicFile
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

private const val MAX_IMPORT_BYTES = 524_288
private const val MAX_RECORDS = 128
private const val MAX_NAME_LENGTH = 80
private const val RECORD_SCHEMA_VERSION = 1
private const val SELECTION_SCHEMA_VERSION = 1
private val RECORD_ID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
private val DIGEST = Regex("^[0-9a-f]{64}$")

@InvokeArg
class StoredRecordArgs {
    var schemaVersion: Int = 0
    lateinit var id: String
    lateinit var name: String
    lateinit var normalizedName: String
    lateinit var digest: String
    lateinit var content: String
}

@InvokeArg
class RemoveRecordArgs { lateinit var id: String }

@InvokeArg
class SelectionArgs {
    var schemaVersion: Int = 0
    lateinit var source: String
    lateinit var id: String
}

private class LayoutStorageException(val code: String, message: String) : Exception(message)

@TauriPlugin
class KeyboardHelperLayoutsPlugin(private val activity: Activity) : Plugin(activity) {
    private val recordsDirectory get() = File(activity.filesDir, "custom-layouts-v1")
    private val selectionFile get() = File(activity.filesDir, "selected-layout-v1.json")
    private var pickerActive = false

    @Command
    fun pickLayout(invoke: Invoke) {
        if (pickerActive) {
            invoke.reject("A layout picker is already open.", "picker-busy")
            return
        }
        pickerActive = true
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json", "text/json", "text/plain"))
        }
        try {
            startActivityForResult(invoke, intent, "layoutPickerResult")
        } catch (error: Exception) {
            pickerActive = false
            invoke.reject("The Android document picker could not be opened.", "picker-unavailable", error)
        }
    }

    @ActivityCallback
    fun layoutPickerResult(invoke: Invoke, result: ActivityResult) {
        pickerActive = false
        if (result.resultCode == Activity.RESULT_CANCELED) {
            invoke.resolve(JSObject().put("cancelled", true))
            return
        }
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.reject("Android did not return a readable layout document.", "picker-failed")
            return
        }
        try {
            val bytes = readBounded(uri)
            val decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
            val response = JSObject()
                .put("cancelled", false)
                .put("content", decoder.decode(ByteBuffer.wrap(bytes)).toString())
                .put("displayName", displayName(uri))
                .put("sizeBytes", bytes.size)
            invoke.resolve(response)
        } catch (error: LayoutStorageException) {
            invoke.reject(error.message, error.code)
        } catch (_: java.nio.charset.CharacterCodingException) {
            invoke.reject("The selected layout is not valid UTF-8.", "invalid-utf8")
        } catch (error: Exception) {
            invoke.reject("The selected layout could not be read.", "document-unreadable", error)
        }
    }

    @Command
    fun listRecords(invoke: Invoke) {
        val records = JSONArray()
        val diagnostics = JSONArray()
        try {
            val files = recordsDirectory.listFiles { file -> file.isFile && file.extension == "json" }
                ?.sortedBy { it.name } ?: emptyList()
            for (file in files.take(MAX_RECORDS)) {
                try {
                    val bytes = file.readBytes()
                    if (bytes.size > MAX_IMPORT_BYTES * 2) throw Exception("oversized record")
                    val value = JSONObject(String(bytes, StandardCharsets.UTF_8))
                    validateRecord(value)
                    records.put(value)
                } catch (_: Exception) {
                    diagnostics.put("A stored custom layout was skipped because it is unreadable or unsupported.")
                }
            }
            if (files.size > MAX_RECORDS) {
                diagnostics.put("Additional custom layouts were skipped because the catalog limit is 128.")
            }
            invoke.resolve(JSObject().put("records", records).put("diagnostics", diagnostics))
        } catch (error: Exception) {
            invoke.reject("Custom layouts could not be loaded.", "storage-unavailable", error)
        }
    }

    @Command
    fun writeRecord(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(StoredRecordArgs::class.java)
            val record = JSONObject()
                .put("schemaVersion", args.schemaVersion)
                .put("id", args.id)
                .put("name", args.name)
                .put("normalizedName", args.normalizedName)
                .put("digest", args.digest)
                .put("content", args.content)
            validateRecord(record)
            recordsDirectory.mkdirs()
            val existing = recordsDirectory.listFiles { file -> file.isFile && file.extension == "json" }?.size ?: 0
            val target = recordFile(args.id)
            if (!target.exists() && existing >= MAX_RECORDS) {
                throw LayoutStorageException("catalog-full", "The custom layout limit is 128.")
            }
            writeAtomic(target, record.toString().toByteArray(StandardCharsets.UTF_8))
            invoke.resolve()
        } catch (error: LayoutStorageException) {
            invoke.reject(error.message, error.code)
        } catch (error: Exception) {
            invoke.reject("The custom layout could not be saved.", "storage-write-failed", error)
        }
    }

    @Command
    fun removeRecord(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(RemoveRecordArgs::class.java)
            val target = recordFile(args.id)
            if (target.exists() && !target.delete()) throw Exception("delete failed")
            invoke.resolve()
        } catch (error: LayoutStorageException) {
            invoke.reject(error.message, error.code)
        } catch (error: Exception) {
            invoke.reject("The custom layout could not be removed.", "storage-remove-failed", error)
        }
    }

    @Command
    fun readSelection(invoke: Invoke) {
        if (!selectionFile.exists()) {
            invoke.resolve(JSObject().put("selection", null).put("diagnostic", null))
            return
        }
        try {
            val bytes = selectionFile.readBytes()
            if (bytes.size > 1024) throw Exception("oversized preference")
            val selection = JSONObject(String(bytes, StandardCharsets.UTF_8))
            validateSelection(selection)
            invoke.resolve(JSObject().put("selection", selection).put("diagnostic", null))
        } catch (_: Exception) {
            invoke.resolve(JSObject().put("selection", null).put("diagnostic", "The saved layout selection was reset."))
        }
    }

    @Command
    fun writeSelection(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SelectionArgs::class.java)
            val selection = JSONObject()
                .put("schemaVersion", args.schemaVersion)
                .put("source", args.source)
                .put("id", args.id)
            validateSelection(selection)
            writeAtomic(selectionFile, selection.toString().toByteArray(StandardCharsets.UTF_8))
            invoke.resolve()
        } catch (error: LayoutStorageException) {
            invoke.reject(error.message, error.code)
        } catch (error: Exception) {
            invoke.reject("The selected layout could not be saved.", "preference-write-failed", error)
        }
    }

    private fun readBounded(uri: Uri): ByteArray {
        return activity.contentResolver.openInputStream(uri)?.use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            var total = 0
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                total += read
                if (total > MAX_IMPORT_BYTES) {
                    throw LayoutStorageException("document-too-large", "The selected layout is larger than 512 KiB.")
                }
                output.write(buffer, 0, read)
            }
            output.toByteArray()
        } ?: throw LayoutStorageException("document-unreadable", "The selected layout could not be opened.")
    }

    private fun recordFile(id: String): File {
        validateId(id)
        return File(recordsDirectory, "$id.json")
    }

    private fun validateId(id: String) {
        if (!RECORD_ID.matches(id)) {
            throw LayoutStorageException("invalid-record", "The custom layout identity is invalid.")
        }
    }

    private fun validateRecord(value: JSONObject) {
        if (value.optInt("schemaVersion") != RECORD_SCHEMA_VERSION) {
            throw LayoutStorageException("unsupported-record", "The custom layout record version is unsupported.")
        }
        validateId(value.optString("id"))
        val name = value.optString("name")
        val normalizedName = value.optString("normalizedName")
        val content = value.optString("content")
        if (name.isBlank() || name.length > MAX_NAME_LENGTH || normalizedName.isBlank() || normalizedName.length > MAX_NAME_LENGTH) {
            throw LayoutStorageException("invalid-record", "The custom layout name is invalid.")
        }
        if (!DIGEST.matches(value.optString("digest")) || content.toByteArray(StandardCharsets.UTF_8).size > MAX_IMPORT_BYTES) {
            throw LayoutStorageException("invalid-record", "The custom layout record is invalid.")
        }
    }

    private fun validateSelection(value: JSONObject) {
        if (value.optInt("schemaVersion") != SELECTION_SCHEMA_VERSION) {
            throw LayoutStorageException("unsupported-preference", "The saved selection version is unsupported.")
        }
        val source = value.optString("source")
        val id = value.optString("id")
        if (source !in setOf("bundled", "custom") || id.isBlank() || id.length > 128 || (source == "custom" && !RECORD_ID.matches(id))) {
            throw LayoutStorageException("invalid-preference", "The saved layout selection is invalid.")
        }
    }

    private fun writeAtomic(file: File, bytes: ByteArray) {
        file.parentFile?.mkdirs()
        val atomic = AtomicFile(file)
        val stream = atomic.startWrite()
        try {
            stream.write(bytes)
            stream.fd.sync()
            atomic.finishWrite(stream)
        } catch (error: Exception) {
            atomic.failWrite(stream)
            throw error
        }
    }

    private fun displayName(uri: Uri): String? {
        var cursor: Cursor? = null
        return try {
            cursor = activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            if (cursor != null && cursor.moveToFirst()) cursor.getString(0)?.take(120) else null
        } catch (_: Exception) {
            null
        } finally {
            cursor?.close()
        }
    }
}
