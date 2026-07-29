import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing credentials, read from android/key.properties.
//
// That file holds a password and is gitignored — it must never be committed.
// The keystore it points at is the app's permanent identity: Play Store will
// reject any build signed with a different key, so losing the file or its
// password means never being able to update this app again. Back both up
// somewhere separate from this laptop.
//
// See docs/DEPLOYMENT-CHECKLIST.md for how to generate it.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        load(FileInputStream(keystorePropertiesFile))
    }
}
val hasReleaseKeystore = keystorePropertiesFile.exists() &&
    keystoreProperties.getProperty("storeFile") != null

android {
    namespace = "com.goldfortune.gf_merch_rep"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.goldfortune.gf_merch_rep"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
            }
        }
    }

    buildTypes {
        release {
            // Falls back to the debug key when no keystore is configured, so a
            // fresh clone still builds and `flutter run --release` still works.
            // The build prints which one it used — a release quietly signed with
            // debug keys is rejected by Play Store and, worse, can never be
            // replaced by a properly signed build afterwards.
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
}

// Says out loud which key a release build is using. Silence is how a debug-signed
// APK reaches a store listing.
tasks.whenTaskAdded {
    if (name.contains("assembleRelease") || name.contains("bundleRelease")) {
        doFirst {
            if (hasReleaseKeystore) {
                println("▸ Signing release with the keystore in android/key.properties")
            } else {
                println(
                    "▸ WARNING: no android/key.properties — signing release with DEBUG keys. " +
                        "Not distributable. See docs/DEPLOYMENT-CHECKLIST.md."
                )
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
