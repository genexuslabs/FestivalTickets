resource "azurerm_api_management" "main" {
  name                = "${var.prefix}-apim-${random_string.random-name.result}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  publisher_name      = var.apimPublisherName
  publisher_email     = var.apimPublisherEmail
  sku_name            = "Developer_1"
  
  identity {
    type = "SystemAssigned"
  }
  timeouts {
    create = "120m"
  }
}

resource "azurerm_api_management_policy" "cors" {
  api_management_id = azurerm_api_management.main.id
  xml_content       = templatefile("apim_policy_template.xml", {
    frontend_url = "https://${azurerm_cdn_endpoint.main.name}.azureedge.net"
  })
}

resource "azurerm_windows_function_app" "backend" {
  name                = "${var.prefix}-festivaltickets-backend"
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

  # Environment variables
  app_settings = {
    # "GX_STORAGE_ACCOUNT_NAME" = azurerm_storage_account.main.name
    # "GX_STORAGE_ACCESS_KEY" = azurerm_storage_account.main.primary_access_key
    "GX_CONNECTION-NOSQLDB-DATASOURCE" = tostring("${azurerm_cosmosdb_account.main.connection_strings[0]}")
  }
}