pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven("https://stream-io-repo.com") { content { includeGroup("io.getstream") } }
    }
}
rootProject.name = "AndroidRemoteHub"
include(":app")
