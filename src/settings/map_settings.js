/**
 * Settings used by the map in all apps.
 */
export let mapSettings = {
    //Optional. Azure Maps authentication information.
	azureMapsAuth: {

		// TODO: This tokenServiceUrl appears to be broken/down
		//Option 1: Use Azure Active Directory authentication for secure access to Azure Maps.
		/* authType: "anonymous",
		clientId: "15e642ec-d2c8-407a-8893-321be53ec607", //Your Azure Maps client id for accessing your Azure Maps account.
		getToken: function (resolve, reject, map) {
			//URL to your authentication service that retrieves an Azure Active Directory Token.
			var tokenServiceUrl = "https://spatial-annotation-tool-maps-auth.azurewebsites.net/api/GetAzureMapsToken";

			fetch(tokenServiceUrl).then(r => r.text()).then(token => resolve(token));
		} */

		//Option 2: Use an Azure Maps key. Get an Azure Maps key at https://azure.com/maps. NOTE: The primary key should be used as the key.
		authType: "subscriptionKey",
		subscriptionKey: process.env.AZ_MAPS_SUBSCRIPTION_KEY
	},

    //A URL to a CORs enabled proxy service that can be leveraged for cross domain requests. Cross domain URL would be appended to this proxy service URL.
    proxyService: undefined
};