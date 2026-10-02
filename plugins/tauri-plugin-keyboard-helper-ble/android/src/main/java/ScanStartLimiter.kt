package me.maxistar.keyboardhelper.ble

/**
 * Mirrors Android's scan start budget (five starts per 30 seconds). Beyond it the platform drops
 * the start silently, so the plugin refuses it up front with a time to wait. Confined to the main
 * looper like the rest of the plugin state.
 */
class ScanStartLimiter(
    private val limit: Int = 5,
    private val windowMs: Long = 30_000,
) {
    private val starts = ArrayDeque<Long>()

    /** Records a start at [nowMs] and returns null, or returns how long to wait without recording. */
    fun tryAcquire(nowMs: Long): Long? {
        while (starts.isNotEmpty() && nowMs - starts.first() >= windowMs) starts.removeFirst()
        if (starts.size >= limit) return windowMs - (nowMs - starts.first())
        starts.addLast(nowMs)
        return null
    }
}
