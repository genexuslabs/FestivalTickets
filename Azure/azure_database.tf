resource "random_password" "password" {
   length  = 32
   special = true
}

resource "azurerm_mssql_server" "main" {
  name                         = "${var.prefix}-sqlserver-${random_string.random-name.result}"
  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  version                      = "12.0"
  administrator_login          = "sqladmin"
  administrator_login_password = random_password.password.result
}

resource "azurerm_mssql_database" "main" {
  name                             = "${var.dbName}"
  server_id                        = azurerm_mssql_server.main.id
  sku_name                         = "S0"
}

resource "azurerm_mssql_firewall_rule" "azureservicefirewall" {
  name                = "${var.prefix}-allow-azure-service"
  server_id           = azurerm_mssql_server.main.id
  start_ip_address    = "0.0.0.0"
  end_ip_address      = "0.0.0.0"
}