package com.auth

internal fun acceptsAuthCallback(activeGeneration: Long?, callbackGeneration: Long): Boolean =
    activeGeneration != null && activeGeneration > 0L && callbackGeneration == activeGeneration

internal fun acceptsAuthStateCallback(
    activeGeneration: Long?,
    callbackGeneration: Long,
    activeStateEpoch: Long?,
    callbackStateEpoch: Long?,
    currentStateEpoch: Long,
): Boolean =
    acceptsAuthCallback(activeGeneration, callbackGeneration) &&
        activeStateEpoch != null &&
        activeStateEpoch == callbackStateEpoch &&
        activeStateEpoch == currentStateEpoch
