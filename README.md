# compare-packagexml-files
Small script to read the package.xml from two Salesforce orgs based on package name or package.xml and then showing the differences among the package.xml files. Most useful for managed package development where the package contents may be different in two distibution orgs.

## Requirements ##
Must have the SalesforceDX CLI installed and configured with Salesforce orgs.

## Usage ##
Show help
```
$ ./packagexml-diff.js --help
```
Run using default options against two orgs (lekkim1 and lekkim2) aliased in SalesforceDX
```
$ ./packagexml-diff.js --org1 lekkim1 --org2 lekkim2
```