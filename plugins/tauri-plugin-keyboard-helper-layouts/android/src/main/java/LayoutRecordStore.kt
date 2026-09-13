package me.maxistar.keyboardhelper.layouts

import android.util.AtomicFile
import java.io.File

internal class LayoutRecordStore(filesDirectory: File) {
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
