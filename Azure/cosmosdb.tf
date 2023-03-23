resource "azurerm_cosmosdb_account" "main" {
  name                = "${var.prefix}-cosmos-db-${random_string.random-name.result}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"

  # azurerm_cosmosdb_account  = true
  
  enable_automatic_failover = false
  enable_free_tier          = true

  # is_virtual_network_filter_enabled = true
  # 52.244.48.71 eliminar
  ip_range_filter   = "${chomp(data.http.myip.body)},104.42.195.92,40.76.54.131,52.176.6.30,52.169.50.45,52.187.184.26,0.0.0.0"

  consistency_policy {
    consistency_level       = "BoundedStaleness"
    max_interval_in_seconds = 300
    max_staleness_prefix    = 100000
  }
  
  geo_location {
    location          = azurerm_resource_group.main.location
    failover_priority = 0
  }
  
  depends_on = [
    azurerm_resource_group.main
  ]
}

resource "azurerm_cosmosdb_sql_database" "main" {
  name                = "cosmosdb-database"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
}

resource "azurerm_cosmosdb_sql_container" "dticket" {
  name                  = "DTicket"
  resource_group_name   = azurerm_resource_group.main.name
  account_name          = azurerm_cosmosdb_account.main.name
  database_name         = azurerm_cosmosdb_sql_database.main.name
  partition_key_path    = "/id"
  partition_key_version = 1
  # throughput            = var.throughput

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/*"
    }

    included_path {
      path = "/included/?"
    }

    excluded_path {
      path = "/excluded/?"
    }

    composite_index {
      index{
        path = "/DEventId"
        order = "Ascending"
      }
      index{
        path = "/DUserEmail"
        order = "Ascending"
      }
    }
  }

  unique_key {
    paths = ["/definition/DEventId", "/definition/DUserEmail"]
  }
}

resource "azurerm_cosmosdb_sql_container" "dcache" {
  name                  = "DCache"
  resource_group_name   = azurerm_resource_group.main.name
  account_name          = azurerm_cosmosdb_account.main.name
  database_name         = azurerm_cosmosdb_sql_database.main.name
  partition_key_path    = "/id"
  partition_key_version = 1
  # throughput            = var.throughput

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/*"
    }

    included_path {
      path = "/included/?"
    }

    excluded_path {
      path = "/excluded/?"
    }
 }
}