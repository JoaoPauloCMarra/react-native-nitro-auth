package com.auth

private const val MILLIS_PER_SECOND = 1000L

internal fun epochSecondsToMillisOrNull(epochSeconds: Long): Long? = when {
    epochSeconds > Long.MAX_VALUE / MILLIS_PER_SECOND -> null
    epochSeconds < Long.MIN_VALUE / MILLIS_PER_SECOND -> Long.MIN_VALUE
    else -> epochSeconds * MILLIS_PER_SECOND
}

internal fun expirationMillisFromExpiresIn(nowMillis: Long, expiresInSeconds: Long): Long? {
    if (expiresInSeconds <= 0 || expiresInSeconds > Long.MAX_VALUE / MILLIS_PER_SECOND) return null
    val lifetimeMillis = expiresInSeconds * MILLIS_PER_SECOND
    if (nowMillis > Long.MAX_VALUE - lifetimeMillis) return null
    return nowMillis + lifetimeMillis
}
