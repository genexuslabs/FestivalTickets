data "azurerm_subscription" "main" {}
data "azurerm_client_config" "main" {}
data "azuread_client_config" "current" {}

resource "azuread_application" "main" {
   display_name = "${var.prefix}FestivalTickets"
   owners       = [data.azuread_client_config.current.object_id]
}
 
resource "azuread_service_principal" "main" {
  application_id               = azuread_application.main.application_id
  owners       = [data.azuread_client_config.current.object_id]
}

resource "azuread_service_principal_password" "sp-password" {
  service_principal_id = azuread_service_principal.main.id
  end_date_relative    = "17520h" #2y
}

resource "azurerm_role_assignment" "contributor" {
  scope                = data.azurerm_subscription.main.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.main.id
}