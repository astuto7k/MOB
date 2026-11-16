package com.androidremotehub.session

/** Uses monotonic time for leases. Network authority must stay fresh; wall-clock changes cannot extend it. */
class AuthorizationGate(private val monotonicMillis: () -> Long) {
    companion object {
        const val LEASE_MILLIS = 10_000L
        val SAFE_PACKAGES = setOf("com.androidremotehub", "com.google.android.calculator", "com.android.calculator2", "com.google.android.deskclock", "com.android.deskclock")
    }
    @Volatile private var sessionId: String? = null
    @Volatile private var active = false
    @Volatile private var control = false
    @Volatile private var connected = false
    @Volatile private var leaseAt = Long.MIN_VALUE
    private var lastSequence = -1L
    private var windowAt = 0L
    private var eventsInWindow = 0
    @Synchronized fun begin(id: String, allowControl: Boolean) {
        sessionId = id; active = false; control = allowControl; connected = false
        leaseAt = monotonicMillis(); lastSequence = -1; windowAt = leaseAt; eventsInWindow = 0
    }
    fun socket(connected: Boolean) { this.connected = connected }
    fun renew(id: String, status: String, serverAllowsControl: Boolean) {
        if (id != sessionId) return
        if (status !in setOf("APPROVED", "CONNECTING", "ACTIVE")) { stop(); return }
        active = status == "ACTIVE"
        control = control && serverAllowsControl
        leaseAt = monotonicMillis()
    }
    fun isFresh() = sessionId != null && connected && monotonicMillis() - leaseAt in 0 until LEASE_MILLIS
    fun canTransfer(unlocked: Boolean) = active && isFresh() && unlocked
    fun controlAllowed() = control && active && isFresh()
    fun suspendControl() { control = false }
    fun allowControl() { control = true }
    @Synchronized fun authorize(sequence: Long, packageName: String?, unlocked: Boolean, passwordFocused: Boolean): Boolean {
        if (!controlAllowed() || !unlocked || passwordFocused || packageName !in SAFE_PACKAGES || sequence <= lastSequence) return false
        val now = monotonicMillis()
        if (now - windowAt >= 1_000) { windowAt = now; eventsInWindow = 0 }
        if (++eventsInWindow > 40) return false
        lastSequence = sequence
        return true
    }
    fun stop() { sessionId = null; active = false; control = false; connected = false; leaseAt = Long.MIN_VALUE }
}
