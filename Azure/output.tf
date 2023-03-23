# ----------------------------------
# Resource Group
# ----------------------------------
output "account_location" {
  description = "Application Region"
  value     = azurerm_resource_group.main.location
}

output "resource_group_name" {
  description = "Resource Group Name"
  value     = azurerm_resource_group.main.name
}

# ----------------------------------
# Service Principal
# ----------------------------------
#output "service_principal_display_name" {
#  value = "${azuread_service_principal.main.display_name}"
#}

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

# ----------------------------------
# Storage Account
# ----------------------------------
output "storage_account_name" {
  description = "Storage account name"
  value       = azurerm_storage_account.main.name
}

output "storage_account_primary_access_key" {
    description = "Storage shared key"
    value = nonsensitive(azurerm_storage_account.main.primary_access_key)
}

# ----------------------------------
# Cosmos DB
# ----------------------------------
output "datastore_nosqldb_servername" {
  description = "CosmosDB connection string"
  value     = nonsensitive(tostring("${azurerm_cosmosdb_account.main.connection_strings[0]}"))
}

# output "service_principal_object_id" {
#  description = "Service Principal ObjectId"
#  value = "${azuread_service_principal.main.id}"
# }

# ----------------------------------
# Backend - Serverless
# ----------------------------------

output "backend_function_app" {
  description = "Backend app function name"
  value = "${azurerm_windows_function_app.backend.name}"
}

output "backend_apim_servicename" {
  description = "API Management Service Name"
  value = "${azurerm_api_management.main.name}"
}

output "backend_api_service_url" {
  description = "Backend app function url"
  value = "https://${azurerm_windows_function_app.backend.default_hostname}"
}

# ----------------------------------
# Frontend
# ----------------------------------
output "frontend_endpoint" {
  description = "Angular frontend CDN endpoint"
  value       = "https://${azurerm_cdn_endpoint.main.name}.azureedge.net"  
}

output "frontend_servicesurl" {
  description = "Services URL"
  value = "${azurerm_api_management.main.gateway_url}/festivaltickets/"
}

# ----------------------------------
# Backoffice
# ----------------------------------
output "backoffice_endpoint" {
  description = "Backoffice endpoint"
  value       = "https://${azurerm_windows_web_app.bo.name}.azurewebsites.net/businesslogic.bohome.aspx"
  
}

# ----------------------------------
# Azure SQL
# ----------------------------------
output "mssql_servername" {
  description = "The FQDN of the sql server."
  value = azurerm_mssql_server.main.fully_qualified_domain_name
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