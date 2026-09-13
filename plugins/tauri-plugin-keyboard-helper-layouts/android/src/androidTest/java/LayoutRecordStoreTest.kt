package me.maxistar.keyboardhelper.layouts

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class LayoutRecordStoreTest {
    private val id = "11111111-1111-4111-8111-111111111111"

    private fun root(): File {
        val root = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "record-store-${UUID.randomUUID()}")
        root.mkdirs()
        return root
    }

    private fun inlineRecord(name: String = "Inline"): String = """
        {
          "schemaVersion":2,
          "id":"$id",
          "name":"$name",
          "normalizedName":"${name.lowercase()}",
          "digest":"${"a".repeat(64)}",
          "content":"{\"name\":\"$name\"}",
          "format":"json",
          "assets":[],
          "inlineAssets":[{
            "id":"logo",
            "mimeType":"image/png",
            "sizeBytes":4,
            "width":1,
            "height":1,
            "digest":"${"b".repeat(64)}"
          }]
        }
    """.trimIndent()

    @Test
    fun inlineJsonRecordsAreWrittenAtomicallyAndReplacedInPlace() {
        val root = root()
        val store = LayoutRecordStore(root)
        val target = store.legacyRecordFile(id)

        store.writeAtomic(target, inlineRecord("Inline").toByteArray())
        assertTrue(target.isFile)
        assertTrue(target.readText().contains("\"inlineAssets\""))

        store.writeAtomic(target, inlineRecord("Replacement").toByteArray())
        assertTrue(target.readText().contains("Replacement"))
        assertFalse(target.parentFile!!.listFiles().orEmpty().any { it.name.endsWith(".bak") })
        root.deleteRecursively()
    }

    @Test
    fun removalDeletesInlineRecordAndObsoletePackageAssetsForSameIdentity() {
        val root = root()
        val store = LayoutRecordStore(root)
        store.writeAtomic(store.legacyRecordFile(id), inlineRecord().toByteArray())
        File(store.packageRecordDirectory(id), "assets/key.png").also { it.parentFile!!.mkdirs(); it.writeText("obsolete") }

        store.removeRecord(id)

        assertFalse(store.legacyRecordFile(id).exists())
        assertFalse(store.packageRecordDirectory(id).exists())
        root.deleteRecursively()
    }

    @Test
    fun startupCleanupRemovesOnlyAbandonedTransactionDirectories() {
        val root = root()
        val token = "22222222-2222-4222-8222-222222222222"
        File(root, "layout-package-staging-v1/abandoned/file").also { it.parentFile!!.mkdirs(); it.writeText("temporary") }
        File(root, "custom-layout-packages-v1/.commit-$token/file").also { it.parentFile!!.mkdirs(); it.writeText("temporary") }
        File(root, "custom-layout-packages-v1/.backup-$id-$token/file").also { it.parentFile!!.mkdirs(); it.writeText("temporary") }
        File(root, "custom-layout-packages-v1/$id/record.json").also { it.parentFile!!.mkdirs(); it.writeText("obsolete committed package") }

        val store = LayoutRecordStore(root)

        assertFalse(store.stagingDirectory.exists())
        assertFalse(File(store.packageRecordsDirectory, ".commit-$token").exists())
        assertFalse(File(store.packageRecordsDirectory, ".backup-$id-$token").exists())
        assertEquals("obsolete committed package", File(store.packageRecordDirectory(id), "record.json").readText())
        root.deleteRecursively()
    }
}
