# Resource Group
output "account_location" {
  description = "Application Region"
  value     = azurerm_resource_group.main.location
}

# Useless
#output "resource_group_id" {
#  description = "Resource Group Id"
#  value     = azurerm_resource_group.main.id
#}

output "resource_group_name" {
  description = "Resource Group Name"
  value     = azurerm_resource_group.main.name
}

# Storage Account
output "storage_account_name" {
  description = "Storage account name"
  value       = azurerm_storage_account.main.name
}

output "storage_account_primary_access_key" {
    description = "Storage shared key"
    value = nonsensitive(azurerm_storage_account.main.primary_access_key)
}

# Cosmos DB
output "cosmosdb_connection_strings" {
  description = "CosmosDB connection string"
  value     = nonsensitive(azurerm_cosmosdb_account.main.connection_strings)
}

# Service Principal
output "service_principal_display_name" {
  value = "${azuread_service_principal.main.display_name}"
}

output "service_principal_application_id" {
  description = "Service Principal Application Id"
  value = "${azuread_application.main.application_id}"
}

output "service_principal_tenant_id" {
  description = "Service Principal Tenant Id"
  # value = "${azuread_application.main.application_tenant_id}"
  value       = data.azurerm_client_config.main.tenant_id
}

output "service_principal_credentials" {
  description = "Service Principal Credentials"
  value     = nonsensitive(azuread_service_principal_password.sp-password.value)
}

# output "service_principal_object_id" {
#  description = "Service Principal ObjectId"
#  value = "${azuread_service_principal.main.id}"
# }

# ----------------------------------
# Backend - Serverless
# ----------------------------------
output "backend_appfunction_id" {
  description = "Backend app function id"
  value = "${azurerm_windows_function_app.backend.name}"
}

# ----------------------------------
# Frontend
# ----------------------------------
output "frontend_cdn_endpoint" {
  description = "Angular frontend CDN endpoint"
  value       = "https://${azurerm_cdn_endpoint.main.name}.azureedge.net"
  
}

# ----------------------------------
# Backoffice
# ----------------------------------
output "backoffice_endpoint" {
  description = "Backoffice endpoint"
  value       = "https://${azurerm_windows_web_app.bo.name}.azurewebsites.net"
  
}

# ----------------------------------
# Azure SQL
# ----------------------------------
output "mssql_fqdn" {
  description = "The FQDN of the sql server."
  value = azurerm_mssql_server.main.fully_qualified_domain_name
}

output "mssql_db" {
  description = "Database"
  value       = azurerm_mssql_database.main.name
}

output "mssql_user" {
  description = "SQL User"
  value       =  azurerm_mssql_server.main.administrator_login
}

output "mssql_password" {
  description = "SQL Password"
  value       =  nonsensitive(azurerm_mssql_server.main.administrator_login_password)
}

# --------------------
# Azure functions
output "function_ruffle" {
  description = "Ticket Ruffle"
  value       =  azurerm_windows_function_app.ruffle.name
}

output "function_queue" {
  description = "Ticket Ruffle"
  value       =  azurerm_windows_function_app.queue.name
}

# ruffle
# ticket