package me.maxistar.keyboardhelper.ble

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private class FakeScheduler : OperationScheduler {
    private class Task(val at: Long, val runnable: Runnable)

    private var now = 0L
    private val tasks = mutableListOf<Task>()

    override fun postDelayed(delayMs: Long, task: Runnable): Any =
        Task(now + delayMs, task).also(tasks::add)

    override fun cancel(handle: Any) {
        tasks.remove(handle)
    }

    val pendingTimers: Int get() = tasks.size

    fun advance(ms: Long) {
        now += ms
        tasks.filter { it.at <= now }.sortedBy { it.at }.forEach {
            if (tasks.remove(it)) it.runnable.run()
        }
    }
}

private class Recorder : OperationSettler {
    val events = mutableListOf<String>()
    override fun resolve(value: Any?) { events += "resolve:$value" }
    override fun reject(message: String) { events += "reject:$message" }
}

class PendingOperationsTest {
    private val scheduler = FakeScheduler()
    private val timeouts = mutableListOf<OperationKind>()
    private val operations = PendingOperations(scheduler) { timeouts += it }

    @Test
    fun settlesExactlyOnceAndCancelsItsDeadline() {
        val recorder = Recorder()
        assertTrue(operations.register(OperationKind.READ, recorder, 5_000))
        assertEquals(1, scheduler.pendingTimers)

        assertTrue(operations.resolve(OperationKind.READ, "bytes"))
        assertFalse(operations.resolve(OperationKind.READ, "again"))
        assertFalse(operations.reject(OperationKind.READ, "late"))
        assertEquals(0, scheduler.pendingTimers)
        scheduler.advance(10_000)

        assertEquals(listOf("resolve:bytes"), recorder.events)
        assertTrue(timeouts.isEmpty())
    }

    @Test
    fun expiryRejectsWithTimeoutReleasesTheSlotAndNotifies() {
        val recorder = Recorder()
        operations.register(OperationKind.CONNECT, recorder, 20_000)

        scheduler.advance(19_999)
        assertTrue(operations.isActive(OperationKind.CONNECT))
        scheduler.advance(1)

        assertEquals(listOf("reject:timeout: connect timed out"), recorder.events)
        assertFalse(operations.isActive(OperationKind.CONNECT))
        assertEquals(listOf(OperationKind.CONNECT), timeouts)
        assertTrue(operations.register(OperationKind.CONNECT, Recorder(), 20_000))
    }

    @Test
    fun lateResultAfterExpiryDoesNotSettleALaterOperation() {
        val first = Recorder()
        operations.register(OperationKind.READ, first, 1_000)
        scheduler.advance(1_000)

        val second = Recorder()
        operations.register(OperationKind.READ, second, 5_000)
        // A native result for the expired read arrives and is delivered to the current slot.
        // The owner is responsible for the identity check; the timer of the first read must not fire again.
        scheduler.advance(4_000)

        assertEquals(listOf("reject:timeout: characteristic read timed out"), first.events)
        assertTrue(second.events.isEmpty())
        assertTrue(operations.isActive(OperationKind.READ))
    }

    @Test
    fun registeringAnActiveKindIsRefusedWithoutDisturbingIt() {
        val first = Recorder()
        val second = Recorder()
        assertTrue(operations.register(OperationKind.DISCOVERY, first, 10_000))
        assertFalse(operations.register(OperationKind.DISCOVERY, second, 10_000))

        operations.resolve(OperationKind.DISCOVERY)

        assertEquals(listOf("resolve:null"), first.events)
        assertTrue(second.events.isEmpty())
    }

    @Test
    fun rejectAllSettlesEveryKindIncludingConnectAndCancelsTimers() {
        val recorders = OperationKind.values().associateWith { Recorder() }
        recorders.forEach { (kind, recorder) -> operations.register(kind, recorder, 10_000) }

        operations.rejectAll("disconnected: connection closed")

        recorders.values.forEach { assertEquals(listOf("reject:disconnected: connection closed"), it.events) }
        assertFalse(operations.anyActive())
        assertEquals(0, scheduler.pendingTimers)
        scheduler.advance(60_000)
        assertTrue(timeouts.isEmpty())
    }

    @Test
    fun zeroTimeoutMeansNoDeadline() {
        operations.register(OperationKind.SUBSCRIPTION, Recorder(), 0)
        assertEquals(0, scheduler.pendingTimers)
    }

    @Test
    fun anyActiveCanBeScopedToKinds() {
        operations.register(OperationKind.CONNECT, Recorder(), 1_000)
        assertTrue(operations.anyActive())
        assertFalse(operations.anyActive(OperationKind.READ, OperationKind.SUBSCRIPTION))
        assertTrue(operations.anyActive(OperationKind.CONNECT, OperationKind.READ))
    }
}
