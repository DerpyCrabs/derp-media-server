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

    @Test fun rememberedServersAreShownAsQuickActions() {
        context.getSharedPreferences("connection", 0).edit()
            .putStringSet("servers", setOf("https://media.example:3000"))
            .commit()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val recent = activity.findViewById<android.widget.LinearLayout>(R.id.recent_servers)
                assertTrue(recent.isShown)
                assertTrue((0 until recent.childCount).any { index ->
                    (recent.getChildAt(index) as? android.widget.Button)?.text == "https://media.example:3000"
                })
            }
        }
    }

    @Test fun httpConnectionShowsOfflineModeWarning() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                activity.showHttpWarningForTest("http://192.168.1.20:3000")
                val dialog = activity.httpWarningDialogForTest()!!
                val message = dialog.findViewById<android.widget.TextView>(android.R.id.message)
                assertTrue(message!!.text.contains("Service Worker"))
                assertEquals(
                    "Connect anyway",
                    dialog.getButton(android.content.DialogInterface.BUTTON_POSITIVE).text.toString(),
                )
            }
        }
    }
}
