# FestivalTickets - Azure Terraform Sample
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
> Note: This process creates DB tables too.

## Troubleshooting
### Error "Waiting for creation/update of Api Management (ExpiredAuthenticationToken)"
API Management creation can take about 40 minutes and Terraform could throw this error.

Complete error:

```
 Error: waiting for creation/update of Api Management: (Service Name "dev-apim-p6htv" / Resource Group "dev-festivaltickets-rg"): Future#WaitForCompletion: the number of retries has been exceeded: StatusCode=401 -- Original Error: Code="ExpiredAuthenticationToken" Message="The access token expiry UTC time '3/21/2023 12:44:36 PM' is earlier than current UTC time '3/21/2023 12:47:55 PM'."
``` 

Solution:

1. Confirm API Management creation on Azure portal with online status.
2. Run `terraform apply` again. You should get a new error like:
```
    Error: A resource with the ID "/subscriptions/09d9c0bb-6c1b-4866-880a-7d105eee365c/resourceGroups/dev-festivaltickets-rg/providers/Microsoft.ApiManagement/service/dev-apim-p6htv" already exists - to be managed via Terraform this resource needs to be imported into the State. Please see the resource documentation for "azurerm_api_management" for more information.
```
3. Run `terraform import <resource> <id>`. In this case:
```
terraform import "azurerm_api_management.main" "/subscriptions/09d9c0bb-6c1b-4866-880a-7d105eee365c/resourceGroups/dev-festivaltickets-rg/providers/Microsoft.ApiManagement/service/dev-apim-p6htv"
```
Expected output:
```
Import successful!

The resources that were imported are shown above. These resources are now in
your Terraform state and will henceforth be managed by Terraform.
```
4. Run `terraform apply` again.

## Disclaimer
By running this code you may incur in cloud infrastructure costs.
