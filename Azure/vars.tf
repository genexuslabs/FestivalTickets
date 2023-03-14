variable "location" {
    type = string
    default = "eastus"
}

variable "prefix" {
    type = string
    default = "dev"
}

variable "myIpAddress" {
    type =  string
    default = "167.58.169.142"
}

variable "apimPublisherName" {
    type =  string
    default = "GeneXus"
}
variable "apimPublisherEmail" {
    type =  string
    default = "nobody@genexus.com"
}
variable "dbName" {
    type =  string
    default = "festivaltickets"
}