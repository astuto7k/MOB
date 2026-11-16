package com.androidremotehub.session

import org.junit.Assert.*
import org.junit.Test

class AuthorizationGateTest {
    private var now = 1000L
    private fun active(control: Boolean = true): AuthorizationGate = AuthorizationGate { now }.also {
        it.begin("session-one", control); it.socket(true); it.renew("session-one", "ACTIVE", control)
    }
    @Test fun neverAllowsBeforeDeviceApprovalAndActive() {
        val gate = AuthorizationGate { now }
        assertFalse(gate.authorize(1, "com.androidremotehub", true, false))
        gate.begin("session-one", true); gate.socket(true); gate.renew("session-one", "APPROVED", true)
        assertFalse(gate.authorize(1, "com.androidremotehub", true, false))
    }
    @Test fun localViewOnlyApprovalCannotBecomeRemoteControl() {
        val gate = active(false)
        gate.renew("session-one", "ACTIVE", true)
        assertFalse(gate.authorize(1, "com.androidremotehub", true, false))
        gate.allowControl() // Called only by the explicit local approval UI.
        assertTrue(gate.authorize(1, "com.androidremotehub", true, false))
    }
    @Test fun revocationImmediatelyBlocksEveryFollowingCommand() {
        val gate = active()
        assertTrue(gate.authorize(1, "com.androidremotehub", true, false))
        gate.stop()
        assertFalse(gate.authorize(2, "com.androidremotehub", true, false))
        assertFalse(gate.canTransfer(true))
    }
    @Test fun closedSocketBlocksEvenWithFreshLease() {
        val gate = active(); gate.socket(false)
        assertFalse(gate.authorize(1, "com.androidremotehub", true, false))
        assertFalse(gate.canTransfer(true))
    }
    @Test fun tenSecondLeaseExpiresWithoutServerConfirmation() {
        val gate = active()
        now += 9999
        assertTrue(gate.authorize(1, "com.androidremotehub", true, false))
        now += 1
        assertFalse(gate.authorize(2, "com.androidremotehub", true, false))
        assertFalse(gate.canTransfer(true))
    }
    @Test fun wrongSessionCannotRenewExpiredLease() {
        val gate = active(); now += 10001
        gate.renew("another-session", "ACTIVE", true)
        assertFalse(gate.authorize(1, "com.androidremotehub", true, false))
    }
    @Test fun onlyBenignPackagesUnlockedAndNonPassword() {
        val gate = active()
        assertFalse(gate.authorize(1, "com.example.bank", true, false))
        assertFalse(gate.authorize(2, "com.google.android.calculator", false, false))
        assertFalse(gate.authorize(3, "com.androidremotehub", true, true))
        assertFalse(gate.authorize(4, "com.android.settings", true, false))
        assertTrue(gate.authorize(5, "com.google.android.calculator", true, false))
    }
    @Test fun sequenceReplayAndFloodAreRejected() {
        val gate = active()
        assertTrue(gate.authorize(1, "com.androidremotehub", true, false))
        assertFalse(gate.authorize(1, "com.androidremotehub", true, false))
        (2L..40).forEach { assertTrue(gate.authorize(it, "com.androidremotehub", true, false)) }
        assertFalse(gate.authorize(41, "com.androidremotehub", true, false))
        now += 1000
        assertTrue(gate.authorize(42, "com.androidremotehub", true, false))
    }
    @Test fun localSuspensionNeedsNewLocalApproval() {
        val gate = active(); gate.suspendControl()
        gate.renew("session-one", "ACTIVE", true)
        assertFalse(gate.authorize(1, "com.androidremotehub", true, false))
        assertTrue(gate.canTransfer(true))
    }
    @Test fun terminalServerStatesCannotRenewAuthorization() {
        listOf("ENDED", "REJECTED", "EXPIRED", "FAILED").forEach { status ->
            val gate = active(); gate.renew("session-one", status, true)
            assertFalse(gate.authorize(1, "com.androidremotehub", true, false))
        }
    }
}
