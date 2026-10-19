package com.auth

internal enum class Origin {
    LOGIN,
    SCOPES,
    SILENT;

    companion object {
        fun fromExtra(value: String?): Origin = entries.firstOrNull { it.name == value } ?: LOGIN
    }
}
