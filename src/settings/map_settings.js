/**
 * Settings used by the map in all apps.
 */
export let mapSettings = {
    //Optional. Azure Maps authentication information.
	azureMapsAuth: {
		
		//Option 1: Use Azure Active Directory authentication for secure access to Azure Maps.
		 //authType: "anonymous",
		 //clientId: "d069e722-70c3-4dd6-8532-a6f4b18c9bfb", //Your Azure Maps client id for accessing your Azure Maps account.
		 //getToken: function (resolve, reject, map) {
		// 	//URL to your authentication service that retrieves an Azure Active Directory Token.
		 //	var tokenServiceUrl = "https://spatial-annotation-tool-maps-auth2.azurewebsites.net/api/GetAzureMapsToken";

		 //	fetch(tokenServiceUrl).then(r => r.text()).then(token => resolve(token));
		 //}

		//Option 2: Use an Azure Maps key. Get an Azure Maps key at https://azure.com/maps. NOTE: The primary key should be used as the key.
		authType: "subscriptionKey",
		subscriptionKey: "<Your Azure Maps Key>"
	},

    //A URL to a CORs enabled proxy service that can be leveraged for cross domain requests. Cross domain URL would be appended to this proxy service URL. 
    proxyService: undefined
};
