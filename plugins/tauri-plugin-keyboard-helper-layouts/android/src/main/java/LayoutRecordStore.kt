package me.maxistar.keyboardhelper.layouts

import android.util.AtomicFile
import java.io.File

internal class LayoutRecordStore(
    filesDirectory: File,
    private val moveDirectory: (File, File) -> Boolean = { source, target -> source.renameTo(target) },
) {
    val legacyRecordsDirectory = File(filesDirectory, "custom-layouts-v1")
    val packageRecordsDirectory = File(filesDirectory, "custom-layout-packages-v1")
    val stagingDirectory = File(filesDirectory, "layout-package-staging-v1")
    val selectionFile = File(filesDirectory, "selected-layout-v1.json")

    init { cleanupOrphans() }

    fun legacyRecordFile(id: String) = File(legacyRecordsDirectory, "$id.json")
    fun packageRecordDirectory(id: String) = File(packageRecordsDirectory, id)

    fun cleanupOrphans() {
        stagingDirectory.deleteRecursively()
        packageRecordsDirectory.listFiles { file ->
            file.name.startsWith(".commit-") || file.name.startsWith(".backup-")
        }?.forEach { it.deleteRecursively() }
    }

    fun commitPackage(token: String, id: String, source: File, record: ByteArray) {
        packageRecordsDirectory.mkdirs()
        val commit = File(packageRecordsDirectory, ".commit-$token")
        val target = packageRecordDirectory(id)
        val backup = File(packageRecordsDirectory, ".backup-$id-$token")
        commit.deleteRecursively()
        backup.deleteRecursively()
        if (!source.copyRecursively(commit, overwrite = false)) throw Exception("staging copy failed")
        writeAtomic(File(commit, "record.json"), record)
        if (target.exists() && !moveDirectory(target, backup)) {
            commit.deleteRecursively()
            throw Exception("backup failed")
        }
        if (!moveDirectory(commit, target)) {
            if (backup.exists() && !moveDirectory(backup, target)) throw Exception("rollback failed")
            commit.deleteRecursively()
            throw Exception("promotion failed")
        }
        backup.deleteRecursively()
        source.deleteRecursively()
    }

    fun removeRecord(id: String) {
        val legacy = legacyRecordFile(id)
        val packaged = packageRecordDirectory(id)
        if (legacy.exists() && !legacy.delete()) throw Exception("legacy delete failed")
        if (packaged.exists() && !packaged.deleteRecursively()) throw Exception("package delete failed")
    }

    fun writeAtomic(file: File, bytes: ByteArray) {
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
}
