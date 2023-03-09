resource "azurerm_service_plan" "bo" {
  name                     = "${var.prefix}-webapp-service-plan"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  os_type                  = "Windows"
  sku_name                 = "F1"
}

resource "azurerm_windows_web_app" "bo" {
  name                = "${var.prefix}-festivaltickets-backoffice"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_service_plan.bo.location
  service_plan_id     = azurerm_service_plan.bo.id
  
  site_config {
    always_on = false
    application_stack {
      current_stack = "dotnet"
      dotnet_version = "v6.0"
    }
    virtual_application {
        physical_path = "site\\wwwroot"
        preload       = false
        virtual_path  = "/"
    }
  }
}