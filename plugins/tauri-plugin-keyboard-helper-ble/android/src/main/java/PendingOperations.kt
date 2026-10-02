package me.maxistar.keyboardhelper.ble

/** Native GATT operations that can be in flight; at most one of each kind at a time. */
enum class OperationKind(val label: String) {
    CONNECT("connect"),
    DISCOVERY("service discovery"),
    READ("characteristic read"),
    SUBSCRIPTION("notification subscription"),
}

/** Where the outcome of an operation goes. Implemented over a Tauri `Invoke` in the plugin. */
interface OperationSettler {
    fun resolve(value: Any?)
    fun reject(message: String)
}

/** Minimal timer abstraction so deadlines can be driven by a fake clock in JVM tests. */
interface OperationScheduler {
    fun postDelayed(delayMs: Long, task: Runnable): Any
    fun cancel(handle: Any)
}

/**
 * Tracks in-flight native operations. Each registered operation settles exactly once: by
 * [resolve], by [reject], by [rejectAll], or by its deadline. Not thread-safe by design; the
 * plugin confines every call to the main looper.
 */
class PendingOperations(
    private val scheduler: OperationScheduler,
    /** Called after an operation was rejected because its deadline expired. */
    private val onTimeout: (OperationKind) -> Unit = {},
) {
    private class Entry(val settler: OperationSettler, var deadline: Any?)

    private val entries = mutableMapOf<OperationKind, Entry>()

    fun isActive(kind: OperationKind): Boolean = entries.containsKey(kind)

    fun anyActive(vararg kinds: OperationKind): Boolean =
        if (kinds.isEmpty()) entries.isNotEmpty() else kinds.any(entries::containsKey)

    /** Registers [settler] for [kind]. Returns false, leaving the existing operation alone, if one is already active. */
    fun register(kind: OperationKind, settler: OperationSettler, timeoutMs: Long): Boolean {
        if (entries.containsKey(kind)) return false
        val entry = Entry(settler, null)
        entries[kind] = entry
        if (timeoutMs > 0) {
            entry.deadline = scheduler.postDelayed(timeoutMs) { expire(kind, entry) }
        }
        return true
    }

    fun resolve(kind: OperationKind, value: Any? = null): Boolean {
        val entry = take(kind) ?: return false
        entry.settler.resolve(value)
        return true
    }

    fun reject(kind: OperationKind, message: String): Boolean {
        val entry = take(kind) ?: return false
        entry.settler.reject(message)
        return true
    }

    /** Rejects every active operation; used when the connection is closed. */
    fun rejectAll(message: String) {
        entries.keys.toList().forEach { reject(it, message) }
    }

    private fun take(kind: OperationKind): Entry? {
        val entry = entries.remove(kind) ?: return null
        entry.deadline?.let(scheduler::cancel)
        entry.deadline = null
        return entry
    }

    private fun expire(kind: OperationKind, entry: Entry) {
        // A late timer for an operation that already settled (or was replaced) must do nothing.
        if (entries[kind] !== entry) return
        entries.remove(kind)
        entry.deadline = null
        entry.settler.reject("timeout: ${kind.label} timed out")
        onTimeout(kind)
    }
}
