package com.openmausbot.companion.permissions

import android.Manifest
import com.openmausbot.companion.core.CompanionEndpoint
import com.openmausbot.companion.core.CompanionEndpointKind
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class CompanionPermissionsTest {
    @Test
    fun api37RequestsOnlyWhatLocalDiscoveryNeeds() {
        val granted = mutableSetOf<String>()
        val permissions = CompanionPermissions(
            sdkInt = 37,
            granted = { it in granted },
        )
        assertEquals(
            listOf(
                Manifest.permission.NEARBY_WIFI_DEVICES,
                CompanionPermissions.PERMISSION_ACCESS_LOCAL_NETWORK,
            ),
            permissions.discoveryPermissions().toList(),
        )
        assertFalse(
            permissions.discoveryPermissions().contains(Manifest.permission.POST_NOTIFICATIONS),
            "opening the list of nearby computers must not ask for notifications",
        )
        assertTrue(permissions.snapshot.value.discoveryNeedsRequest)
    }

    @Test
    fun api32NeedsNoRuntimeCompanionPermissions() {
        val permissions = CompanionPermissions(
            sdkInt = 32,
            granted = { false },
        )
        assertTrue(permissions.discoveryPermissions().isEmpty())
    }

    @Test
    fun refreshUpdatesObservableDiscoveryStateFromPlatformGrants() {
        val granted = mutableSetOf<String>()
        val permissions = CompanionPermissions(
            sdkInt = 33,
            granted = { it in granted },
        )
        assertTrue(permissions.snapshot.value.discoveryNeedsRequest)
        granted += Manifest.permission.NEARBY_WIFI_DEVICES
        val snap = permissions.refresh()
        assertFalse(snap.discoveryNeedsRequest)
    }

    @Test
    fun api37LanRouteAsksForLocalNetworkOnly() {
        val granted = mutableSetOf<String>()
        val permissions = CompanionPermissions(sdkInt = 37, granted = { it in granted })
        val localNetwork = listOf(CompanionPermissions.PERMISSION_ACCESS_LOCAL_NETWORK)

        assertEquals(localNetwork, permissions.localRoutePermissions(listOf(lan)).toList())
        assertEquals(localNetwork, permissions.localRoutePermissions(listOf(bonjour)).toList())
        assertEquals(
            localNetwork,
            permissions.localRoutePermissions(listOf(hosted, lan)).toList(),
            "one local route among those the phone will dial is enough to need the grant",
        )
        assertFalse(
            permissions.localRoutePermissions(listOf(lan)).contains(Manifest.permission.NEARBY_WIFI_DEVICES),
            "dialing a known address is not a browse; nearby devices stays with the list",
        )

        granted += CompanionPermissions.PERMISSION_ACCESS_LOCAL_NETWORK
        assertTrue(permissions.localRoutePermissions(listOf(lan)).isEmpty(), "asked again for a grant it has")
    }

    @Test
    fun hostedAndTailnetRoutesAskForNothing() {
        val permissions = CompanionPermissions(sdkInt = 37, granted = { false })
        assertTrue(permissions.localRoutePermissions(listOf(hosted, tailnet)).isEmpty())
        assertTrue(permissions.localRoutePermissions(emptyList()).isEmpty())
    }

    @Test
    fun api36AsksForNothing() {
        val permissions = CompanionPermissions(sdkInt = 36, granted = { false })
        assertTrue(permissions.localRoutePermissions(listOf(lan, bonjour)).isEmpty())
    }

    @Test
    fun recordAudioIsNeverPartOfTheStartupPrompt() {
        var recordAudioGranted = false
        val permissions = CompanionPermissions(
            sdkInt = 37,
            granted = { it == Manifest.permission.RECORD_AUDIO && recordAudioGranted },
        )
        assertFalse(permissions.recordAudioGranted())
        assertFalse(
            permissions.discoveryPermissions().contains(Manifest.permission.RECORD_AUDIO),
            "RECORD_AUDIO is asked from the mic button or when a Live call starts, never at startup",
        )
        recordAudioGranted = true
        assertTrue(permissions.recordAudioGranted())
    }

    private val lan = route("http://192.168.1.42:8810", CompanionEndpointKind.LAN)
    private val bonjour = route("http://openmausbot-aa.local:8810", CompanionEndpointKind.BONJOUR)
    private val hosted = route("https://mac.companion.example", CompanionEndpointKind.HOSTED)
    private val tailnet = route("http://mac.tail1234.ts.net:8810", CompanionEndpointKind.TAILNET)

    private fun route(url: String, kind: CompanionEndpointKind): CompanionEndpoint =
        assertNotNull(CompanionEndpoint.create(url, kind, priority = 0))
}
