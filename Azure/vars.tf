variable "location" {
    type = string
    default = "eastus"
}

variable "prefix" {
    type = string
    default = "dev"
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