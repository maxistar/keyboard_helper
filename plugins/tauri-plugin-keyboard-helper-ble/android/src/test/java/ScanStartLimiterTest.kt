package me.maxistar.keyboardhelper.ble

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ScanStartLimiterTest {
    @Test
    fun allowsFiveStartsThenReportsTheWaitUntilTheOldestLeavesTheWindow() {
        val limiter = ScanStartLimiter()
        (0 until 5).forEach { assertNull(limiter.tryAcquire(it * 1_000L)) }

        assertEquals(26_000L, limiter.tryAcquire(4_000L))
        assertEquals(21_000L, limiter.tryAcquire(9_000L))
    }

    @Test
    fun refusedStartsDoNotConsumeBudget() {
        val limiter = ScanStartLimiter()
        (0 until 5).forEach { assertNull(limiter.tryAcquire(0L)) }
        repeat(10) { limiter.tryAcquire(1_000L) }

        assertNull(limiter.tryAcquire(30_000L))
    }

    @Test
    fun slotsFreeUpAsTheWindowSlides() {
        val limiter = ScanStartLimiter()
        listOf(0L, 10_000L, 20_000L, 25_000L, 29_000L).forEach { assertNull(limiter.tryAcquire(it)) }

        assertEquals(1_000L, limiter.tryAcquire(29_000L))
        assertNull(limiter.tryAcquire(30_000L))
        assertEquals(10_000L, limiter.tryAcquire(30_000L))
    }
}
