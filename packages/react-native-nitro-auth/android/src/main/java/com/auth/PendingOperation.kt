package com.auth

internal class PendingOperation {
    @Volatile
    var generation: Long? = null
        private set
    var stateEpoch: Long? = null
        private set

    val isPending: Boolean
        get() = generation != null

    fun begin(generation: Long, stateEpoch: Long) {
        this.generation = generation
        this.stateEpoch = stateEpoch
    }

    fun accepts(
        callbackGeneration: Long,
        currentStateEpoch: Long,
        callbackStateEpoch: Long? = stateEpoch,
    ): Boolean = acceptsAuthStateCallback(
        generation,
        callbackGeneration,
        stateEpoch,
        callbackStateEpoch,
        currentStateEpoch,
    )

    fun matches(generation: Long, stateEpoch: Long?): Boolean =
        this.generation == generation && this.stateEpoch == stateEpoch

    fun clear() {
        generation = null
        stateEpoch = null
    }

    fun clearIf(generation: Long) {
        if (this.generation == generation) clear()
    }
}
