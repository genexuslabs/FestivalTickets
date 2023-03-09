resource "azurerm_storage_account" "main" {
  name                     = "${var.prefix}ftsstorage${random_string.random-name.result}"
  location                 = azurerm_resource_group.main.location
  resource_group_name      = azurerm_resource_group.main.name
  account_tier             = "Standard"
  account_replication_type = "LRS"

  static_website {
    index_document = "index.html"
    error_404_document = "index.html" 
  }
}

resource "azurerm_cdn_profile" "main" {
  name                = "${var.prefix}ftcdn-profile"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku = "Standard_Microsoft"
}

resource "azurerm_cdn_endpoint" "main" {
  name                          = "${var.prefix}ftcdnendpoint"
  profile_name                  = azurerm_cdn_profile.main.name
  location                      = azurerm_resource_group.main.location
  resource_group_name           = azurerm_resource_group.main.name
  origin_host_header            = azurerm_storage_account.main.primary_web_host
  querystring_caching_behaviour = "IgnoreQueryString"

  origin {
    name      = "websiteorginaccount"
    host_name = azurerm_storage_account.main.primary_web_host
  }

  delivery_rule  {
    name  = "redirectToIndex"
    order = 1

    url_path_condition  {
      match_values = [
        "1",
      ]
      # negate_condition = true
      operator         = "LessThan"
      transforms       = []
    }

    url_rewrite_action {
      destination             = "/index.html"
      preserve_unmatched_path = false
      source_pattern          = "/"
    }
  }
}

resource "azurerm_storage_queue" "main" {
  name                 = "festivaltickets-queue"
  storage_account_name = azurerm_storage_account.main.name
}


# ------------------
#  blob_properties {
#    cors_rule {
#      allowed_methods    = var.allowed_methods
#      allowed_origins    = var.allowed_origins
#      allowed_headers    = var.allowed_headers
#      exposed_headers    = var.exposed_headers
#      max_age_in_seconds = var.max_age_in_seconds
#    }
#  }
#
#  identity {
#    type = var.assign_identity ? "SystemAssigned" : null
#  }