plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.androidremotehub"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.androidremotehub"
        minSdk = 30
        targetSdk = 37
        versionCode = 5
        versionName = "0.5.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a")
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    flavorDimensions += "notifications"
    productFlavors {
        create("standalone") { dimension = "notifications" }
        create("firebase") {
            dimension = "notifications"
            listOf("FIREBASE_APPLICATION_ID", "FIREBASE_API_KEY", "FIREBASE_PROJECT_ID", "FIREBASE_SENDER_ID").forEach { key ->
                val value = providers.gradleProperty(key).orElse("").get().replace("\\", "\\\\").replace("\"", "\\\"")
                buildConfigField("String", key, "\"$value\"")
            }
        }
    }
    val keyPath = System.getenv("ARH_KEYSTORE_PATH")
    if (!keyPath.isNullOrBlank()) {
        signingConfigs.create("externalRelease") {
            storeFile = file(keyPath)
            storePassword = System.getenv("ARH_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("ARH_KEY_ALIAS")
            keyPassword = System.getenv("ARH_KEY_PASSWORD")
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
    }
    signingConfigs.getByName("debug") {
        enableV1Signing = true
        enableV2Signing = true
        enableV3Signing = true
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (!keyPath.isNullOrBlank()) signingConfig = signingConfigs.getByName("externalRelease")
        }
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
        jniLibs {
            useLegacyPackaging = true
        }
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.03.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:5.5.1")
    implementation("io.getstream:stream-video-webrtc-android:156.0.5")
    "firebaseImplementation"(platform("com.google.firebase:firebase-bom:35.2.0"))
    "firebaseImplementation"("com.google.firebase:firebase-messaging")
    "firebaseImplementation"("androidx.fragment:fragment:1.9.1") // Upgrade Play services transitive 1.1.0 for Activity Result safety.
    testImplementation("junit:junit:4.13.2")
}
