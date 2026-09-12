package me.maxistar.keyboardhelper.layouts

import android.graphics.BitmapFactory
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Locale
import java.util.zip.ZipInputStream

internal const val PACKAGE_FORMAT = "keyboard-helper-layout-package"
internal const val PACKAGE_VERSION = 1
internal const val MAX_PACKAGE_BYTES = 2_097_152
internal const val MAX_PACKAGE_ENTRIES = 64
internal const val MAX_PACKAGE_UNCOMPRESSED_BYTES = 8_388_608
internal const val MAX_PACKAGE_TEXT_BYTES = 524_288
internal const val MAX_PACKAGE_IMAGE_BYTES = 1_048_576
internal const val MAX_PACKAGE_IMAGE_DIMENSION = 2048
private const val MAX_COMPRESSION_RATIO = 100L
private const val MAX_PATH_DEPTH = 4

internal data class PackageAsset(
    val path: String,
    val mimeType: String,
    val sizeBytes: Int,
    val width: Int,
    val height: Int,
    val digest: String,
) {
    fun toJson() = JSONObject()
        .put("path", path)
        .put("mimeType", mimeType)
        .put("sizeBytes", sizeBytes)
        .put("width", width)
        .put("height", height)
        .put("digest", digest)
}

internal data class PreparedLayoutPackage(
    val directory: File,
    val layoutPath: String,
    val content: String,
    val digest: String,
    val assets: List<PackageAsset>,
)

private data class CentralEntry(
    val name: String,
    val compressedSize: Long,
    val uncompressedSize: Long,
    val directory: Boolean,
)

internal object LayoutPackageSupport {
    fun prepare(bytes: ByteArray, directory: File): PreparedLayoutPackage {
        if (bytes.size > MAX_PACKAGE_BYTES) fail("package-too-large", "The layout package is larger than 2 MiB.")
        val central = inspectCentralDirectory(bytes)
        if (central.isEmpty() || central.size > MAX_PACKAGE_ENTRIES) fail("package-entry-limit", "The layout package entry limit is 64.")
        val seen = mutableSetOf<String>()
        central.forEach { entry ->
            val normalized = normalizeArchivePath(entry.name, entry.directory)
            if (!seen.add(normalized.lowercase(Locale.ROOT))) fail("package-path-collision", "The layout package contains colliding paths.")
            if (!entry.directory && entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize.coerceAtLeast(1) > MAX_COMPRESSION_RATIO) {
                fail("package-compression-limit", "The layout package contains an excessive compression ratio.")
            }
            if (entry.uncompressedSize > MAX_PACKAGE_IMAGE_BYTES && normalized != "manifest.json") {
                fail("package-file-too-large", "A layout package file exceeds its size limit.")
            }
        }
        if (central.sumOf { it.uncompressedSize.coerceAtLeast(0) } > MAX_PACKAGE_UNCOMPRESSED_BYTES) {
            fail("package-expanded-too-large", "The expanded layout package is larger than 8 MiB.")
        }
        if (directory.exists()) directory.deleteRecursively()
        if (!directory.mkdirs()) fail("package-staging-failed", "The layout package could not be prepared.")
        try {
            extract(bytes, directory, central)
            return inspectDirectory(directory)
        } catch (error: Exception) {
            directory.deleteRecursively()
            if (error is LayoutStorageException) throw error
            fail("package-structure-invalid", "The ZIP content does not match its directory metadata.")
        }
    }

    fun inspectDirectory(directory: File): PreparedLayoutPackage {
        val files = directory.walkTopDown().filter { it.isFile && it.name != "record.json" }.toList()
        if (files.isEmpty() || files.size > MAX_PACKAGE_ENTRIES) fail("package-entry-limit", "The stored package has an invalid entry count.")
        var total = 0L
        val byPath = linkedMapOf<String, ByteArray>()
        for (file in files) {
            val relative = file.relativeTo(directory).invariantSeparatorsPath
            val normalized = normalizeArchivePath(relative, false)
            val bytes = readFileBounded(file, if (normalized == "manifest.json") MAX_PACKAGE_TEXT_BYTES else MAX_PACKAGE_IMAGE_BYTES)
            total += bytes.size
            if (total > MAX_PACKAGE_UNCOMPRESSED_BYTES) fail("package-expanded-too-large", "The stored package is too large.")
            byPath[normalized] = bytes
        }
        val manifestBytes = byPath["manifest.json"] ?: fail("package-manifest-missing", "The layout package manifest is missing.")
        val manifest = JSONObject(decodeUtf8(manifestBytes, "package-manifest-invalid"))
        if (manifest.optString("format") != PACKAGE_FORMAT || manifest.optInt("version", -1) != PACKAGE_VERSION) {
            fail("package-version-unsupported", "The layout package format or version is unsupported.")
        }
        val layoutPath = normalizeGeneralPath(manifest.optString("layout"))
        if (layoutPath == "manifest.json" || layoutPath.startsWith("assets/")) fail("package-layout-invalid", "The package layout path is invalid.")
        val layoutBytes = byPath[layoutPath] ?: fail("package-layout-missing", "The package layout document is missing.")
        if (layoutBytes.size > MAX_PACKAGE_TEXT_BYTES) fail("package-layout-too-large", "The package layout is larger than 512 KiB.")
        val content = decodeUtf8(layoutBytes, "invalid-utf8")
        val layout = try { JSONObject(content) } catch (_: Exception) { fail("invalid-json", "The package layout is not valid JSON.") }
        val references = mutableSetOf<String>()
        collectImageReferences(layout, references)
        if (references.isEmpty()) fail("package-assets-unused", "The layout package does not reference an image asset.")
        val normalizedReferences = references.mapTo(mutableSetOf()) { normalizeAssetPath(it) }
        val assetFiles = byPath.filterKeys { it.startsWith("assets/") }
        val allowed = setOf("manifest.json", layoutPath) + assetFiles.keys
        if (byPath.keys.any { it !in allowed }) fail("package-file-unsupported", "The layout package contains an unsupported file.")
        if (assetFiles.keys != normalizedReferences) {
            fail("package-asset-unavailable", "Package assets are missing or unreferenced.")
        }
        val assets = assetFiles.entries.sortedBy { it.key }.map { (path, bytes) -> inspectImage(path, bytes) }
        return PreparedLayoutPackage(directory, layoutPath, content, canonicalDigest(byPath), assets)
    }

    fun assetArray(assets: List<PackageAsset>): JSONArray = JSONArray().also { array -> assets.forEach { array.put(it.toJson()) } }

    fun normalizeAssetPath(value: String): String {
        val normalized = normalizeArchivePath(value, false)
        if (!normalized.startsWith("assets/") || normalized.length <= "assets/".length) {
            fail("package-asset-reference-invalid", "A layout image is outside the package assets directory.")
        }
        return normalized
    }

    private fun extract(bytes: ByteArray, directory: File, central: List<CentralEntry>) {
        val centralByName = central.associateBy { normalizeArchivePath(it.name, it.directory).lowercase(Locale.ROOT) }
        var count = 0
        var total = 0L
        ZipInputStream(ByteArrayInputStream(bytes), StandardCharsets.UTF_8).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                count += 1
                if (count > MAX_PACKAGE_ENTRIES) fail("package-entry-limit", "The layout package entry limit is 64.")
                val normalized = normalizeArchivePath(entry.name, entry.isDirectory)
                val metadata = centralByName[normalized.lowercase(Locale.ROOT)]
                    ?: fail("package-structure-invalid", "The ZIP directory does not match its entries.")
                if (entry.isDirectory != metadata.directory) fail("package-structure-invalid", "The ZIP entry type is inconsistent.")
                if (!entry.isDirectory) {
                    val perFile = if (normalized == "manifest.json") MAX_PACKAGE_TEXT_BYTES else MAX_PACKAGE_IMAGE_BYTES
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        val read = zip.read(buffer)
                        if (read < 0) break
                        total += read
                        if (output.size() + read > perFile) fail("package-file-too-large", "A layout package file exceeds its size limit.")
                        if (total > MAX_PACKAGE_UNCOMPRESSED_BYTES) fail("package-expanded-too-large", "The expanded layout package is larger than 8 MiB.")
                        output.write(buffer, 0, read)
                    }
                    if (output.size().toLong() != metadata.uncompressedSize) {
                        fail("package-structure-invalid", "The ZIP entry size does not match its directory metadata.")
                    }
                    val target = File(directory, normalized)
                    target.parentFile?.mkdirs()
                    target.writeBytes(output.toByteArray())
                }
                zip.closeEntry()
            }
        }
        if (count != central.size) fail("package-structure-invalid", "The ZIP directory does not match its entries.")
    }

    private fun inspectCentralDirectory(bytes: ByteArray): List<CentralEntry> {
        val eocd = findSignatureBackwards(bytes, 0x06054b50)
        if (eocd < 0 || eocd + 22 > bytes.size) fail("package-archive-invalid", "The selected package is not a valid ZIP archive.")
        val count = u16(bytes, eocd + 10)
        val centralSize = u32(bytes, eocd + 12)
        val centralOffset = u32(bytes, eocd + 16)
        if (count > MAX_PACKAGE_ENTRIES) fail("package-entry-limit", "The layout package entry limit is 64.")
        if (centralOffset + centralSize > bytes.size) fail("package-archive-invalid", "The ZIP directory is invalid.")
        var offset = centralOffset.toInt()
        return buildList {
            repeat(count) {
                if (offset + 46 > bytes.size || u32(bytes, offset) != 0x02014b50L) fail("package-archive-invalid", "The ZIP directory is invalid.")
                val flags = u16(bytes, offset + 8)
                val method = u16(bytes, offset + 10)
                if (flags and 1 != 0) fail("package-encrypted", "Encrypted layout packages are unsupported.")
                if (method !in setOf(0, 8)) fail("package-compression-unsupported", "The layout package uses unsupported compression.")
                val compressed = u32(bytes, offset + 20)
                val uncompressed = u32(bytes, offset + 24)
                val nameLength = u16(bytes, offset + 28)
                val extraLength = u16(bytes, offset + 30)
                val commentLength = u16(bytes, offset + 32)
                val externalAttributes = u32(bytes, offset + 38)
                val end = offset + 46 + nameLength + extraLength + commentLength
                if (nameLength == 0 || end > bytes.size) fail("package-archive-invalid", "The ZIP entry name is invalid.")
                val nameBytes = bytes.copyOfRange(offset + 46, offset + 46 + nameLength)
                val name = decodeUtf8(nameBytes, "package-path-invalid")
                val unixMode = (externalAttributes ushr 16).toInt()
                if (unixMode and 0xf000 == 0xa000) fail("package-link-unsupported", "Package links are unsupported.")
                add(CentralEntry(name, compressed, uncompressed, name.endsWith("/")))
                offset = end
            }
        }
    }

    private fun inspectImage(path: String, bytes: ByteArray): PackageAsset {
        if (bytes.isEmpty() || bytes.size > MAX_PACKAGE_IMAGE_BYTES) fail("package-image-size", "A package image has an invalid size.")
        val mime = when {
            bytes.size >= 8 && bytes.copyOfRange(0, 8).contentEquals(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) -> "image/png"
            bytes.size >= 3 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() && bytes[2] == 0xff.toByte() -> "image/jpeg"
            bytes.size >= 12 && String(bytes, 0, 4, StandardCharsets.US_ASCII) == "RIFF" && String(bytes, 8, 4, StandardCharsets.US_ASCII) == "WEBP" -> "image/webp"
            else -> fail("package-image-type", "A package image has an unsupported signature.")
        }
        val expectedExtension = when (mime) { "image/png" -> setOf("png"); "image/jpeg" -> setOf("jpg", "jpeg"); else -> setOf("webp") }
        if (path.substringAfterLast('.', "").lowercase(Locale.ROOT) !in expectedExtension) fail("package-image-type", "A package image extension does not match its content.")
        val ascii = String(bytes, StandardCharsets.ISO_8859_1)
        if ((mime == "image/png" && ascii.contains("acTL")) || (mime == "image/webp" && (ascii.contains("ANIM") || ascii.contains("ANMF")))) {
            fail("package-image-animated", "Animated package images are unsupported.")
        }
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        if (options.outWidth !in 1..MAX_PACKAGE_IMAGE_DIMENSION || options.outHeight !in 1..MAX_PACKAGE_IMAGE_DIMENSION) {
            fail("package-image-dimensions", "A package image has invalid or excessive dimensions.")
        }
        return PackageAsset(path, mime, bytes.size, options.outWidth, options.outHeight, sha256(bytes))
    }

    private fun collectImageReferences(value: Any?, output: MutableSet<String>) {
        when (value) {
            is JSONArray -> {
                if (value.length() >= 3 && value.opt(2) is String && value.optString(2).isNotBlank()) output.add(value.optString(2))
                repeat(value.length()) { collectImageReferences(value.opt(it), output) }
            }
            is JSONObject -> value.keys().forEach { key ->
                if (key == "image" && value.opt(key) is String && value.optString(key).isNotBlank()) output.add(value.optString(key))
                else collectImageReferences(value.opt(key), output)
            }
        }
    }

    private fun canonicalDigest(files: Map<String, ByteArray>): String {
        val digest = MessageDigest.getInstance("SHA-256")
        files.entries.sortedBy { it.key }.forEach { (path, bytes) ->
            digest.update(path.toByteArray(StandardCharsets.UTF_8)); digest.update(0)
            digest.update(ByteBuffer.allocate(8).putLong(bytes.size.toLong()).array()); digest.update(bytes); digest.update(0)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun normalizeGeneralPath(value: String): String = normalizeArchivePath(value, false)

    private fun normalizeArchivePath(value: String, directory: Boolean): String {
        if (value.isBlank() || value.startsWith("/") || value.contains('\\') || value.contains(':') || value.indexOf('\u0000') >= 0) {
            fail("package-path-invalid", "The layout package contains an unsafe path.")
        }
        val candidate = if (directory) value.removeSuffix("/") else value
        val segments = candidate.split('/')
        if (segments.isEmpty() || segments.size > MAX_PATH_DEPTH || segments.any { it.isBlank() || it == "." || it == ".." }) {
            fail("package-path-invalid", "The layout package contains an unsafe path.")
        }
        return candidate
    }

    private fun decodeUtf8(bytes: ByteArray, code: String): String = try {
        StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
    } catch (_: Exception) { fail(code, "The layout package contains invalid UTF-8 text.") }

    private fun readFileBounded(file: File, limit: Int): ByteArray {
        if (!file.isFile || file.length() !in 1..limit.toLong()) fail("package-file-invalid", "A stored package file is invalid.")
        return file.readBytes()
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun u16(bytes: ByteArray, offset: Int): Int = (bytes[offset].toInt() and 0xff) or ((bytes[offset + 1].toInt() and 0xff) shl 8)
    private fun u32(bytes: ByteArray, offset: Int): Long = (0..3).fold(0L) { value, index -> value or ((bytes[offset + index].toLong() and 0xff) shl (8 * index)) }
    private fun findSignatureBackwards(bytes: ByteArray, signature: Int): Int {
        for (offset in bytes.size - 4 downTo maxOf(0, bytes.size - 65_557)) if (u32(bytes, offset) == signature.toLong()) return offset
        return -1
    }

    private fun fail(code: String, message: String): Nothing = throw LayoutStorageException(code, message)
}
