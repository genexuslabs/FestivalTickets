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
  app_settings = {
    "GX_STORAGE_ACCOUNT_NAME" = azurerm_storage_account.main.name
    "GX_STORAGE_ACCESS_KEY" = azurerm_storage_account.main.primary_access_key
    "GX_CONNECTION-NOSQLDB-DATASOURCE" = tostring("${azurerm_cosmosdb_account.main.connection_strings[0]}")

    "GX_CONNECTION-DEFAULT-DATASOURCE" = azurerm_mssql_server.main.fully_qualified_domain_name
    "GX_CONNECTION-DEFAULT-USER" = azurerm_mssql_server.main.administrator_login
    "GX_CONNECTION-DEFAULT-PASSWORD" = azurerm_mssql_server.main.administrator_login_password
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
  app_settings = {
    # "GX_STORAGE_ACCOUNT_NAME" = azurerm_storage_account.main.name
    # "GX_STORAGE_ACCESS_KEY" = azurerm_storage_account.main.primary_access_key
    "GX_CONNECTION-NOSQLDB-DATASOURCE" = tostring("${azurerm_cosmosdb_account.main.connection_strings[0]}")

    "GX_CONNECTION-DEFAULT-DATASOURCE" = azurerm_mssql_server.main.fully_qualified_domain_name
    "GX_CONNECTION-DEFAULT-USER" = azurerm_mssql_server.main.administrator_login
    "GX_CONNECTION-DEFAULT-PASSWORD" = azurerm_mssql_server.main.administrator_login_password
  }
}
