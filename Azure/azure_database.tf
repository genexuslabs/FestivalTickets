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

resource "null_resource" "db_creation" {
  depends_on = [azurerm_mssql_database.main]
#  triggers = {
#    always_run = timestamp()
#  }
  provisioner "local-exec" {
    interpreter = ["PowerShell", "-Command"]
    command = "sqlcmd -S ${azurerm_mssql_server.main.fully_qualified_domain_name} -d ${azurerm_mssql_database.main.name}  -U sqladmin -P \"${chomp(azurerm_mssql_server.main.administrator_login_password)}\" -i .\\db_setup.sql"
  }
}

resource "azurerm_mssql_firewall_rule" "azureservicefirewall" {
  name                = "${var.prefix}-allow-azure-service"
  server_id           = azurerm_mssql_server.main.id
  start_ip_address    = "0.0.0.0"
  end_ip_address      = "0.0.0.0"
}

resource "azurerm_mssql_firewall_rule" "myip" {
  name                = "${var.prefix}-allow-mypublicip"
  server_id           = azurerm_mssql_server.main.id
  start_ip_address    = "${chomp(data.http.myip.body)}"
  end_ip_address      = "${chomp(data.http.myip.body)}"
}