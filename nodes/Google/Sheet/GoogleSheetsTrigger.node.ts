import { IExecuteFunctions } from 'n8n-core';

import {
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	IDataObject,
	ILoadOptionsFunctions,
	INodeCredentialTestResult,
	INodeExecutionData,
	IPollFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import {
	GoogleSheet,
	ILookupValues,
	ISheetUpdateData,
	IToDelete,
	ValueInputOption,
	ValueRenderOption,
} from './GoogleSheet';

import {
	getAccessToken,
	googleApiRequest,
	hexToRgb,
	IGoogleAuthCredentials,
	googleApiRequestAllItems,
	structureArrayDataByColumn,
	encodeRange
} from './GenericFunctions';

export class GoogleSheetsTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Google Sheets Trigger',
		name: 'googleSheetsTrigger',
		icon: 'file:googleSheets.svg',
		group: ['trigger'],
		version: [1, 2],
		description: 'Trigger when new rows are detected in a Google Sheet',
		defaults: {
			name: 'Google Sheets Trigger',
		},
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'googleApi',
				required: true,
				displayOptions: {
					show: {
						authentication: ['serviceAccount'],
					},
				},
				testedBy: 'googleApiCredentialTest',
			},
			{
				name: 'googleSheetsOAuth2Api',
				required: true,
				displayOptions: {
					show: {
						authentication: ['oAuth2'],
					},
				},
			},
		],
		polling: true,
		properties: [
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{
						name: 'Service Account',
						value: 'serviceAccount',
					},
					{
						name: 'OAuth2',
						value: 'oAuth2',
					},
				],
				default: 'serviceAccount',
				displayOptions: {
					show: {
						'@version': [1],
					},
				},
			},
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{
						// eslint-disable-next-line n8n-nodes-base/node-param-display-name-miscased
						name: 'OAuth2 (recommended)',
						value: 'oAuth2',
					},
					{
						name: 'Service Account',
						value: 'serviceAccount',
					},
				],
				default: 'oAuth2',
				displayOptions: {
					show: {
						'@version': [2],
					},
				},
			},

			{
				displayName: 'Spreadsheet ID',
				name: 'sheetId',
				type: 'string',
				default: '',
				required: true,
				description:
					'The ID of the Google Spreadsheet. Found as part of the sheet URL https://docs.google.com/spreadsheets/d/{ID}/.',
			},
			{
				displayName: 'Range',
				name: 'range',
				type: 'string',
				default: 'A:F',
				required: true,
				description:
					'The table range to read from or to append data to. See the Google <a href="https://developers.google.com/sheets/api/guides/values#writing">documentation</a> for the details. If it contains multiple sheets it can also be added like this: "MySheet!A:F"',
			},


			{
				displayName: 'RAW Data',
				name: 'rawData',
				type: 'boolean',
				default: false,
				description:
					'Whether the data should be returned RAW instead of parsed into keys according to their header',
			},
			{
				displayName: 'Data Property',
				name: 'dataProperty',
				type: 'string',
				default: 'data',
				description: 'The name of the property into which to write the RAW data',
			},
		],
	};

	methods = {

		loadOptions: {

			// Get all the sheets in a Spreadsheet
			async getSheets(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const spreadsheetId = this.getCurrentNodeParameter('sheetId') as string;

				const sheet = new GoogleSheet(spreadsheetId, this);
				const responseData = await sheet.spreadsheetGetSheets();

				if (responseData === undefined) {
					throw new NodeOperationError(this.getNode(), 'No data got returned');
				}

				const returnData: INodePropertyOptions[] = [];
				for (const sheet of responseData.sheets!) {
					if (sheet.properties!.sheetType !== 'GRID') {
						continue;
					}

					returnData.push({
						name: sheet.properties!.title as string,
						value: sheet.properties!.sheetId as unknown as string,
					});
				}

				return returnData;
			},
		},
		credentialTest: {
			async googleApiCredentialTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				try {
					const tokenRequest = await getAccessToken.call(
						this,
						credential.data! as unknown as IGoogleAuthCredentials,
					);
					if (!tokenRequest.access_token) {
						return {
							status: 'Error',
							message: 'Could not generate a token from your private key.',
						};
					}
				} catch (err) {
					return {
						status: 'Error',
						message: `Private key validation failed: ${err.message}`,
					};
				}

				return {
					status: 'OK',
					message: 'Connection successful!',
				};
			},
		},
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const pollData = this.getWorkflowStaticData('node');
		const lastRow = (pollData.lastRow as number) || 1;
		const spreadsheetId = this.getNodeParameter('sheetId', 0) as string;
		let range = this.getNodeParameter('range', 0) as string;
		range = encodeRange(range)
		const options = this.getNodeParameter('options', 0) as IDataObject;
		const valueInputMode = (options.valueInputMode || 'RAW') as ValueInputOption;
		const valueRenderMode = (options.valueRenderMode || 'UNFORMATTED_VALUE') as ValueRenderOption;


		try {
			const rawData = this.getNodeParameter('rawData', 0) as boolean;
			const qs = {
				valueRenderOption: valueRenderMode,
			};
			const sheetData = await googleApiRequest.call(this, 'GET', `/v4/spreadsheets/${spreadsheetId}/values/${range}`, {}, qs);
			const totalRows = sheetData.values!.length;
			let returnData: IDataObject[];
			if (!sheetData) {
				returnData = [];
			} else if (rawData === true) {
				const dataProperty = this.getNodeParameter('dataProperty', 0) as string;
				returnData = [
					{
						[dataProperty]: sheetData.values,
					},
				];
			} else {
				returnData = structureArrayDataByColumn(sheetData.values, 0, lastRow);
			}

			pollData.lastRow = totalRows;

			if (returnData.length === 0 && options.continue) {
				returnData = [{}];
			}

			return [this.helpers.returnJsonArray(returnData)];
		} catch (error) {
			throw error;
		}
	}
}
