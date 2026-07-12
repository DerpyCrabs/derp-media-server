package com.derpmedia.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ServerConnectionResolverTest {
    @Test fun addressWithoutProtocolTriesHttpsThenHttp() {
        assertEquals(
            listOf("https://media.example:3000", "http://media.example:3000"),
            ServerConnectionResolver.candidates("media.example:3000/"),
        )
    }

    @Test fun explicitProtocolIsTriedFirstButDoesNotPreventDetection() {
        assertEquals(
            listOf("http://media.example:3000/share/abc", "https://media.example:3000/share/abc"),
            ServerConnectionResolver.candidates("http://media.example:3000/share/abc"),
        )
    }
}
