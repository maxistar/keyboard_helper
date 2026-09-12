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
    private val token = "22222222-2222-4222-8222-222222222222"

    private fun root(): File {
        val root = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "record-store-${UUID.randomUUID()}")
        root.mkdirs()
        return root
    }

    private fun staged(root: File, marker: String): File = File(root, "source-$marker").also { directory ->
        directory.mkdirs()
        File(directory, "layout.json").writeText(marker)
    }

    @Test
    fun legacyRecordsSurviveInitializationAndPackageCommitIsAtomic() {
        val root = root()
        val legacy = File(root, "custom-layouts-v1/$id.json")
        legacy.parentFile!!.mkdirs()
        legacy.writeText("legacy")

        val store = LayoutRecordStore(root)
        assertEquals("legacy", store.legacyRecordFile(id).readText())
        store.commitPackage(token, id, staged(root, "new"), "record-new".toByteArray())

        assertEquals("new", File(store.packageRecordDirectory(id), "layout.json").readText())
        assertEquals("record-new", File(store.packageRecordDirectory(id), "record.json").readText())
        assertTrue(legacy.exists())
        root.deleteRecursively()
    }

    @Test
    fun replacementFailureRollsBackAndSuccessfulReplacementRemovesBackup() {
        val root = root()
        val initial = LayoutRecordStore(root)
        initial.commitPackage(token, id, staged(root, "old"), "record-old".toByteArray())

        val failing = LayoutRecordStore(root) { source, target ->
            if (source.name.startsWith(".commit-")) false else source.renameTo(target)
        }
        var failed = false
        try { failing.commitPackage(token, id, staged(root, "failed"), "record-failed".toByteArray()) }
        catch (_: Exception) { failed = true }
        assertTrue(failed)
        assertEquals("old", File(failing.packageRecordDirectory(id), "layout.json").readText())
        assertEquals("record-old", File(failing.packageRecordDirectory(id), "record.json").readText())

        val recovered = LayoutRecordStore(root)
        recovered.commitPackage(token, id, staged(root, "replacement"), "record-replacement".toByteArray())
        assertEquals("replacement", File(recovered.packageRecordDirectory(id), "layout.json").readText())
        assertFalse(recovered.packageRecordsDirectory.listFiles().orEmpty().any { it.name.startsWith(".") })
        root.deleteRecursively()
    }

    @Test
    fun removalDeletesOnlyTheTargetRecordAndOwnedAssets() {
        val root = root()
        val store = LayoutRecordStore(root)
        store.commitPackage(token, id, staged(root, "owned"), "record".toByteArray())
        val otherId = "33333333-3333-4333-8333-333333333333"
        store.commitPackage("44444444-4444-4444-8444-444444444444", otherId, staged(root, "other"), "other-record".toByteArray())
        store.legacyRecordFile(id).also { it.parentFile!!.mkdirs(); it.writeText("legacy") }

        store.removeRecord(id)

        assertFalse(store.packageRecordDirectory(id).exists())
        assertFalse(store.legacyRecordFile(id).exists())
        assertTrue(store.packageRecordDirectory(otherId).exists())
        root.deleteRecursively()
    }

    @Test
    fun startupCleanupRemovesOnlyAbandonedTransactionDirectories() {
        val root = root()
        File(root, "layout-package-staging-v1/abandoned/file").also { it.parentFile!!.mkdirs(); it.writeText("temporary") }
        File(root, "custom-layout-packages-v1/.commit-$token/file").also { it.parentFile!!.mkdirs(); it.writeText("temporary") }
        File(root, "custom-layout-packages-v1/.backup-$id-$token/file").also { it.parentFile!!.mkdirs(); it.writeText("temporary") }
        File(root, "custom-layout-packages-v1/$id/record.json").also { it.parentFile!!.mkdirs(); it.writeText("committed") }

        val store = LayoutRecordStore(root)

        assertFalse(store.stagingDirectory.exists())
        assertFalse(File(store.packageRecordsDirectory, ".commit-$token").exists())
        assertFalse(File(store.packageRecordsDirectory, ".backup-$id-$token").exists())
        assertEquals("committed", File(store.packageRecordDirectory(id), "record.json").readText())
        root.deleteRecursively()
    }
}
