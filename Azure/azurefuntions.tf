resource "azurerm_service_plan" "main" {
  name                     = "${var.prefix}-festivaltickets-service-plan"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  os_type                  = "Windows"
  sku_name                 = "Y1"
}

resource "azurerm_windows_function_app" "ruffle" {
  name                = "${var.prefix}-festivaltickets-ruffle"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  
  storage_account_name = azurerm_storage_account.main.name
  service_plan_id      = azurerm_service_plan.main.id
  storage_account_access_key = azurerm_storage_account.main.primary_access_key
  # Windows (empty)
  functions_extension_version = "~4"
  
  site_config {
    application_stack {
      dotnet_version = "v6.0"
      use_dotnet_isolated_runtime = true
    }
  }
}

resource "azurerm_windows_function_app" "queue" {
  name                = "${var.prefix}-festivaltickets-queue"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  
  storage_account_name = azurerm_storage_account.main.name
  service_plan_id      = azurerm_service_plan.main.id
  storage_account_access_key = azurerm_storage_account.main.primary_access_key
  # Windows (empty)
  functions_extension_version = "~4"
  
  site_config {
    application_stack {
      dotnet_version = "v6.0"
      use_dotnet_isolated_runtime = true
    }
  }
}
