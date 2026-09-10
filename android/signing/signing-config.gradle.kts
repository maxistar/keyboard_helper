    // KEYBOARD_HELPER_ANDROID_SIGNING_CONFIG_START
    signingConfigs {
        create("release") {
            val signingPropertiesFile = rootProject.file("keystore.properties")
            check(signingPropertiesFile.isFile) {
                "Android release signing properties file is missing: ${signingPropertiesFile.path}"
            }
            val signingProperties = Properties().apply {
                signingPropertiesFile.inputStream().use { load(it) }
            }
            val requiredProperties = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
            val missingProperties = requiredProperties.filter { signingProperties.getProperty(it).isNullOrBlank() }
            check(missingProperties.isEmpty()) {
                "Android release signing properties are incomplete: ${missingProperties.joinToString(", ")}"
            }
            storeFile = rootProject.file(signingProperties.getProperty("storeFile"))
            storePassword = signingProperties.getProperty("storePassword")
            keyAlias = signingProperties.getProperty("keyAlias")
            keyPassword = signingProperties.getProperty("keyPassword")
        }
    }
    // KEYBOARD_HELPER_ANDROID_SIGNING_CONFIG_END

