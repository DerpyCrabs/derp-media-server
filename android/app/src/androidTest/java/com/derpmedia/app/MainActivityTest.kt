package com.derpmedia.app

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Before fun clearConnection() {
        context.getSharedPreferences("connection", 0).edit().clear().commit()
    }

    @After fun cleanup() = clearConnection()

    @Test fun connectionScreenIsEnglishAndVisible() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val title = activity.findViewById<android.widget.TextView>(R.id.connection_title)
                val input = activity.findViewById<android.widget.EditText>(R.id.connection_input)
                val button = activity.findViewById<android.widget.Button>(R.id.connection_button)
                assertEquals("Derp Media", title.text.toString())
                assertEquals("Server address or share link", input.hint.toString())
                assertEquals("Connect", button.text.toString())
                assertTrue(title.isShown && input.isShown && button.isShown)
            }
        }
    }

    @Test fun connectionScreenAccountsForSystemInsets() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val root = activity.findViewById<android.view.View>(R.id.connection_root)
                assertTrue("Expected top safe-area padding", root.paddingTop > 48)
                val title = activity.findViewById<android.view.View>(R.id.connection_title)
                val location = IntArray(2).also(title::getLocationOnScreen)
                assertTrue("Title must be below the display cutout", location[1] >= root.paddingTop)
            }
        }
    }

    @Test fun invalidAddressShowsValidationError() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val input = activity.findViewById<android.widget.EditText>(R.id.connection_input)
                input.setText("://")
                activity.findViewById<android.widget.Button>(R.id.connection_button).performClick()
                assertEquals("Invalid server address", input.error.toString())
            }
        }
    }

    @Test fun remoteHttpAddressIsRejectedBecauseOfflineModeRequiresHttps() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val input = activity.findViewById<android.widget.EditText>(R.id.connection_input)
                input.setText("http://192.168.1.20:3100")
                activity.findViewById<android.widget.Button>(R.id.connection_button).performClick()
                assertEquals("HTTPS is required for offline access", input.error.toString())
            }
        }
    }
}
