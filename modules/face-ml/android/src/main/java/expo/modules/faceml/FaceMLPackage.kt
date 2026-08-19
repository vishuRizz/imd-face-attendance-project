package expo.modules.faceml

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Re-export so Expo can find it
class FaceMLPackage : expo.modules.core.interfaces.Package {
    override fun createModules(context: android.content.Context): List<expo.modules.core.interfaces.InternalModule> = emptyList()
    override fun createExportedModules(context: android.content.Context): List<expo.modules.core.ExportedModule> = emptyList()
    override fun createViewManagers(context: android.content.Context): List<com.facebook.react.uimanager.ViewManager<*, *>> = emptyList()
    override fun createReactModuleInfoProvider(): com.facebook.react.ReactPackage? = null
}
