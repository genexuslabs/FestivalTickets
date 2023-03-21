# FestivalTickets - Azure Terraform sample
Festival Tickets is an example of a massive event ticket giveaway, which can have hundreds of thousands or millions of subscriptions per hour.

For more information about FestivalTickets, follow this link:
[FestivalTickets Sample](https://wiki.genexus.com/commwiki/servlet/wiki?51266,KB%3AFestivalTickets+-+High+Scalability+Sample)

This stack will Deploy:
* Resource group
* Cosmos DB container DTicket
* Cosmos DB container DCache
* Amazon SQL Server
* Azure storage account for
    * Storage queue for ticket process
    * Ticket PDF
    * Static website
* CDN Profile for Angular frontend
* Azure function app to process the Queue
* Azure function app Cron for ticket ruffle
* Azure function app for backend services
* API Management services for Angular backend
* Webapp for backoffice

## Running the script
Prerequsites:
* Install terraform
    * https://developer.hashicorp.com/terraform/tutorials/aws-get-started/install-cli
* Azure-CLI
    * https://learn.microsoft.com/en-us/cli/azure/install-azure-cli

Run in your cmd: 
```
//Navigate to a folder of your preference
git clone https://github.com/genexuslabs/FestivalTickets.git
cd FestivalTickets/Azure

// Login azure with your credentials
az login

// Init terraform environment
terraform init

// Execute terraform script
terraform apply
```
