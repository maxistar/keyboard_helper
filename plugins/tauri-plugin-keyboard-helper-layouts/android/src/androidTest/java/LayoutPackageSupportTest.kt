package me.maxistar.keyboardhelper.layouts

import android.graphics.Bitmap
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@RunWith(AndroidJUnit4::class)
class LayoutPackageSupportTest {
    private fun png(): ByteArray = ByteArrayOutputStream().use { output ->
        Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, output)
        output.toByteArray()
    }

    private fun bitmap(format: Bitmap.CompressFormat, width: Int = 2, height: Int = 2): ByteArray = ByteArrayOutputStream().use { output ->
        Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).compress(format, 90, output)
        output.toByteArray()
    }

    private fun boundedCompressionBytes(size: Int): ByteArray {
        // Keep the repeating window below DEFLATE's 32 KiB history so the
        // archive stays under 2 MiB while its ratio remains below the 100:1 gate.
        val chunk = ByteArray(20_000)
        var state = 0x13579bdf
        chunk.indices.forEach { index ->
            state = state xor (state shl 13)
            state = state xor (state ushr 17)
            state = state xor (state shl 5)
            chunk[index] = state.toByte()
        }
        return ByteArray(size) { chunk[it % chunk.size] }
    }

    private fun archive(entries: List<Pair<String, ByteArray>>): ByteArray = ByteArrayOutputStream().use { output ->
        ZipOutputStream(output).use { zip -> entries.forEach { (name, bytes) ->
            zip.putNextEntry(ZipEntry(name)); zip.write(bytes); zip.closeEntry()
        } }
        output.toByteArray()
    }

    private fun mutateCentralEntry(
        source: ByteArray,
        name: String,
        mutation: (ByteArray, Int) -> Unit,
    ): ByteArray {
        val bytes = source.copyOf()
        val needle = name.toByteArray(StandardCharsets.UTF_8)
        for (offset in 0..bytes.size - 46 - needle.size) {
            if (readU32(bytes, offset) != 0x02014b50L) continue
            val nameLength = readU16(bytes, offset + 28)
            if (nameLength == needle.size && bytes.copyOfRange(offset + 46, offset + 46 + nameLength).contentEquals(needle)) {
                mutation(bytes, offset)
                return bytes
            }
        }
        throw AssertionError("Central entry not found: $name")
    }

    private fun readU16(bytes: ByteArray, offset: Int) =
        (bytes[offset].toInt() and 0xff) or ((bytes[offset + 1].toInt() and 0xff) shl 8)

    private fun readU32(bytes: ByteArray, offset: Int) = (0..3).fold(0L) { value, index ->
        value or ((bytes[offset + index].toLong() and 0xff) shl (index * 8))
    }

    private fun writeU16(bytes: ByteArray, offset: Int, value: Int) {
        bytes[offset] = value.toByte()
        bytes[offset + 1] = (value ushr 8).toByte()
    }

    private fun writeU32(bytes: ByteArray, offset: Int, value: Long) {
        repeat(4) { index -> bytes[offset + index] = (value ushr (index * 8)).toByte() }
    }

    private fun rejectArchive(bytes: ByteArray, expected: String) {
        val root = InstrumentationRegistry.getInstrumentation().targetContext.cacheDir
        var actual: String? = null
        try { LayoutPackageSupport.prepare(bytes, File(root, "reject-${UUID.randomUUID()}")) }
        catch (error: LayoutStorageException) { actual = error.code }
        assertEquals(expected, actual)
    }

    private fun validEntries() = listOf(
        "manifest.json" to """{"format":"keyboard-helper-layout-package","version":1,"layout":"layout.json"}""".toByteArray(),
        "layout.json" to """{"name":"Test","keySize":{"w":50,"h":50,"gap":4},"keyPositions":[{"row":0,"col":0}],"keyLayers":{"default":[["Icon","","assets/key.png"]]}}""".toByteArray(),
        "assets/key.png" to png(),
    )

    private fun rejectCode(entries: List<Pair<String, ByteArray>>, expected: String) {
        val root = InstrumentationRegistry.getInstrumentation().targetContext.cacheDir
        var actual: String? = null
        try { LayoutPackageSupport.prepare(archive(entries), File(root, "reject-$expected")) }
        catch (error: LayoutStorageException) { actual = error.code }
        assertEquals(expected, actual)
    }

    @Test
    fun validPackageIsContentAddressedIndependentlyOfEntryOrder() {
        val root = InstrumentationRegistry.getInstrumentation().targetContext.cacheDir
        val first = LayoutPackageSupport.prepare(archive(validEntries()), File(root, "package-first"))
        val second = LayoutPackageSupport.prepare(archive(validEntries().reversed()), File(root, "package-second"))
        assertEquals(first.digest, second.digest)
        assertEquals("image/png", first.assets.single().mimeType)
        assertEquals(2, first.assets.single().width)
        first.directory.deleteRecursively(); second.directory.deleteRecursively()
    }

    @Test
    fun traversalIsRejectedWithoutEscapingStaging() {
        val root = InstrumentationRegistry.getInstrumentation().targetContext.cacheDir
        val staging = File(root, "package-traversal")
        var rejected = false
        try { LayoutPackageSupport.prepare(archive(validEntries() + ("../escape.png" to png())), staging) }
        catch (error: LayoutStorageException) { rejected = error.code == "package-path-invalid" }
        assertTrue(rejected)
        assertTrue(!File(root, "escape.png").exists())
    }

    @Test
    fun unsafeAliasesDepthEncryptionLinksAndCompressionAreRejected() {
        listOf("/absolute.png", "assets\\key.png", "assets/../key.png", "a/b/c/d/e.png").forEach { path ->
            rejectCode(validEntries() + (path to png()), "package-path-invalid")
        }
        val base = archive(validEntries())
        rejectArchive(mutateCentralEntry(base, "assets/key.png") { bytes, offset ->
            writeU16(bytes, offset + 8, readU16(bytes, offset + 8) or 1)
        }, "package-encrypted")
        rejectArchive(mutateCentralEntry(base, "assets/key.png") { bytes, offset ->
            writeU16(bytes, offset + 10, 99)
        }, "package-compression-unsupported")
        rejectArchive(mutateCentralEntry(base, "assets/key.png") { bytes, offset ->
            writeU32(bytes, offset + 38, 0xa000L shl 16)
        }, "package-link-unsupported")
        rejectArchive(mutateCentralEntry(base, "assets/key.png") { bytes, offset ->
            writeU32(bytes, offset + 20, 1)
            writeU32(bytes, offset + 24, 101)
        }, "package-compression-limit")
    }

    @Test
    fun malformedMetadataTextAndUnsupportedInventoryAreRejected() {
        val base = archive(validEntries())
        rejectArchive(mutateCentralEntry(base, "layout.json") { bytes, offset ->
            writeU32(bytes, offset + 24, readU32(bytes, offset + 24) + 1)
        }, "package-structure-invalid")
        rejectCode(validEntries().filterNot { it.first == "manifest.json" }, "package-manifest-missing")
        rejectCode(validEntries().map { if (it.first == "manifest.json") it.first to byteArrayOf(0xc3.toByte(), 0x28) else it }, "package-manifest-invalid")
        rejectCode(validEntries().map { if (it.first == "layout.json") it.first to byteArrayOf(0xc3.toByte(), 0x28) else it }, "invalid-utf8")
        rejectCode(validEntries().map { if (it.first == "layout.json") it.first to "not-json".toByteArray() else it }, "invalid-json")
        rejectCode(validEntries() + ("notes.txt" to "unexpected".toByteArray()), "package-file-unsupported")
        rejectCode(validEntries().map { if (it.first == "layout.json") it.first to "{\"name\":\"No assets\"}".toByteArray() else it }, "package-assets-unused")
    }

    @Test
    fun expandedLayoutAndImageBoundsAreRejected() {
        val expanded = validEntries() + (0 until 9).map { "assets/padding-$it.bin" to boundedCompressionBytes(1_000_000) }
        rejectArchive(archive(expanded), "package-expanded-too-large")
        rejectCode(validEntries().map { if (it.first == "layout.json") it.first to boundedCompressionBytes(MAX_PACKAGE_TEXT_BYTES + 1) else it }, "package-layout-too-large")
        rejectCode(validEntries().map { if (it.first == "assets/key.png") it.first to boundedCompressionBytes(MAX_PACKAGE_IMAGE_BYTES + 1) else it }, "package-file-too-large")
    }

    @Test
    fun manifestInventoryAndCollisionFailuresAreDeterministic() {
        rejectCode(validEntries().map { if (it.first == "manifest.json") it.first to it.second.toString(Charsets.UTF_8).replace("\"version\":1", "\"version\":2").toByteArray() else it }, "package-version-unsupported")
        rejectCode(validEntries().filterNot { it.first == "assets/key.png" }, "package-asset-unavailable")
        rejectCode(validEntries() + ("assets/Key.png" to png()), "package-path-collision")
        rejectCode(validEntries() + ("assets/unused.png" to png()), "package-asset-unavailable")
        rejectCode(validEntries().map { if (it.first == "layout.json") it.first to it.second.toString(Charsets.UTF_8).replace("assets/key.png", "../key.png").toByteArray() else it }, "package-path-invalid")
    }

    @Test
    fun imageTypesAnimationAndDimensionsAreBounded() {
        rejectCode(validEntries().map { if (it.first == "assets/key.png") it.first to "not-an-image".toByteArray() else it }, "package-image-type")
        rejectCode(validEntries().map { if (it.first == "assets/key.png") "assets/key.gif" to "GIF89a".toByteArray() else if (it.first == "layout.json") it.first to it.second.toString(Charsets.UTF_8).replace("key.png", "key.gif").toByteArray() else it }, "package-image-type")
        rejectCode(validEntries().map { if (it.first == "assets/key.png") "assets/key.svg" to "<svg/>".toByteArray() else if (it.first == "layout.json") it.first to it.second.toString(Charsets.UTF_8).replace("key.png", "key.svg").toByteArray() else it }, "package-image-type")
        rejectCode(validEntries().map { if (it.first == "assets/key.png") "assets/key.jpg" to it.second else if (it.first == "layout.json") it.first to it.second.toString(Charsets.UTF_8).replace("key.png", "key.jpg").toByteArray() else it }, "package-image-type")
        rejectCode(validEntries().map { if (it.first == "assets/key.png") it.first to (it.second + "acTL".toByteArray()) else it }, "package-image-animated")
        rejectCode(validEntries().map { if (it.first == "assets/key.png") it.first to byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) else it }, "package-image-dimensions")
        rejectCode(validEntries().map { if (it.first == "assets/key.png") it.first to bitmap(Bitmap.CompressFormat.PNG, 2049, 1) else it }, "package-image-dimensions")
    }

    @Test
    fun corruptStoredPackageIsRejectedWithoutAffectingAnotherPackage() {
        val root = InstrumentationRegistry.getInstrumentation().targetContext.cacheDir
        val first = LayoutPackageSupport.prepare(archive(validEntries()), File(root, "stored-first-${UUID.randomUUID()}"))
        val second = LayoutPackageSupport.prepare(archive(validEntries()), File(root, "stored-second-${UUID.randomUUID()}"))
        File(first.directory, first.assets.single().path).delete()
        var code: String? = null
        try { LayoutPackageSupport.inspectDirectory(first.directory) }
        catch (error: LayoutStorageException) { code = error.code }
        assertEquals("package-asset-unavailable", code)
        assertEquals(second.digest, LayoutPackageSupport.inspectDirectory(second.directory).digest)
        first.directory.deleteRecursively()
        second.directory.deleteRecursively()
    }

    @Test
    fun pngJpegAndWebpPassiveImagesAreAccepted() {
        val root = InstrumentationRegistry.getInstrumentation().targetContext.cacheDir
        val formats = listOf(
            Triple("png", Bitmap.CompressFormat.PNG, "image/png"),
            Triple("jpg", Bitmap.CompressFormat.JPEG, "image/jpeg"),
            Triple("webp", Bitmap.CompressFormat.WEBP, "image/webp"),
        )
        formats.forEach { (extension, format, mime) ->
            val entries = validEntries().map {
                if (it.first == "assets/key.png") "assets/key.$extension" to bitmap(format)
                else if (it.first == "layout.json") it.first to it.second.toString(Charsets.UTF_8).replace("key.png", "key.$extension").toByteArray()
                else it
            }
            val result = LayoutPackageSupport.prepare(archive(entries), File(root, "valid-$extension"))
            assertEquals(mime, result.assets.single().mimeType)
            result.directory.deleteRecursively()
        }
    }

    @Test
    fun packageByteAndEntryLimitsFailBeforeCommit() {
        val root = InstrumentationRegistry.getInstrumentation().targetContext.cacheDir
        var byteCode: String? = null
        try { LayoutPackageSupport.prepare(ByteArray(MAX_PACKAGE_BYTES + 1), File(root, "too-large")) }
        catch (error: LayoutStorageException) { byteCode = error.code }
        assertEquals("package-too-large", byteCode)
        val extras = (0 until MAX_PACKAGE_ENTRIES).map { "assets/extra-$it.png" to png() }
        rejectCode(validEntries() + extras, "package-entry-limit")
    }
}
