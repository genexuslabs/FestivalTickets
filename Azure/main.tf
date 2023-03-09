# Resource Group
resource "azurerm_resource_group" "main" {
    name = "${var.prefix}-festivaltickets-rg"
    location = var.location
}

resource "random_string" "random-name" {
  length  = 5
  upper   = false
  lower   = true
  number  = true
  special = false
}