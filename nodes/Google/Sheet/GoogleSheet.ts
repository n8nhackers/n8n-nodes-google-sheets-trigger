import { IDataObject, IPollFunctions, NodeApiError, NodeOperationError } from 'n8n-workflow';

import { IExecuteFunctions, IExecuteSingleFunctions, ILoadOptionsFunctions } from 'n8n-core';

import { googleApiRequest } from './GenericFunctions';

import { utils as xlsxUtils } from 'xlsx';

import { get } from 'lodash';

export interface ISheetOptions {
	scope: string[];
}

export interface IGoogleAuthCredentials {
	email: string;
	privateKey: string;
}

export interface ISheetUpdateData {
	range: string;
	values: string[][];
}

export interface ILookupValues {
	lookupColumn: string;
	lookupValue: string;
}

export interface IToDeleteRange {
	amount: number;
	startIndex: number;
	sheetId: number;
}

export interface IToDelete {
	[key: string]: IToDeleteRange[] | undefined;
	columns?: IToDeleteRange[];
	rows?: IToDeleteRange[];
}

export type ValueInputOption = 'RAW' | 'USER_ENTERED';

export type ValueRenderOption = 'FORMATTED_VALUE' | 'FORMULA' | 'UNFORMATTED_VALUE';


export class GoogleSheet {
	id: string;
	executeFunctions: IExecuteFunctions | ILoadOptionsFunctions;

	constructor(
		spreadsheetId: string,
		executeFunctions: IExecuteFunctions | ILoadOptionsFunctions,
		options?: ISheetOptions | undefined,
	) {
		// options = <SheetOptions>options || {};
		if (!options) {
			options = {} as ISheetOptions;
		}

		this.executeFunctions = executeFunctions;
		this.id = spreadsheetId;
	}

	/**
	 * Encodes the range that also none latin character work
	 *
	 */
	encodeRange(range: string): string {
		if (range.includes('!')) {
			const [sheet, ranges] = range.split('!');
			range = `${encodeURIComponent(sheet)}!${ranges}`;
		}
		return range;
	}




	/**
	 * Returns the cell values
	 */
	async getData(
		range: string,
		valueRenderMode: ValueRenderOption,
	): Promise<string[][] | undefined> {
		const query = {
			valueRenderOption: valueRenderMode,
		};

		const response = await googleApiRequest.call(
			this.executeFunctions,
			'GET',
			`/v4/spreadsheets/${this.id}/values/${range}`,
			{},
			query,
		);

		return response.values as string[][] | undefined;
	}

	/**
	 * Returns the sheets in a Spreadsheet
	 */
	async spreadsheetGetSheets() {
		const query = {
			fields: 'sheets.properties',
		};

		const response = await googleApiRequest.call(
			this.executeFunctions,
			'GET',
			`/v4/spreadsheets/${this.id}`,
			{},
			query,
		);

		return response;
	}

	/**
	 * Returns the given sheet data in a structured way
	 */
	structureData(
		inputData: string[][],
		startRow: number,
		keys: string[],
		addEmpty?: boolean,
	): IDataObject[] {
		const returnData = [];

		let tempEntry: IDataObject, rowIndex: number, columnIndex: number, key: string;

		for (rowIndex = startRow; rowIndex < inputData.length; rowIndex++) {
			tempEntry = {};
			for (columnIndex = 0; columnIndex < inputData[rowIndex].length; columnIndex++) {
				key = keys[columnIndex];
				if (key) {
					// Only add the data for which a key was given and ignore all others
					tempEntry[key] = inputData[rowIndex][columnIndex];
				}
			}
			if (Object.keys(tempEntry).length || addEmpty === true) {
				// Only add the entry if data got found to not have empty ones
				returnData.push(tempEntry);
			}
		}

		return returnData;
	}

	/**
	 * Returns the given sheet data in a structured way using
	 * the startRow as the one with the name of the key
	 */
	structureArrayDataByColumn(
		inputData: string[][],
		keyRow: number,
		dataStartRow: number,
	): IDataObject[] {
		const keys: string[] = [];

		if (keyRow < 0 || dataStartRow < keyRow || keyRow >= inputData.length) {
			// The key row does not exist so it is not possible to structure data
			return [];
		}

		// Create the keys array
		for (let columnIndex = 0; columnIndex < inputData[keyRow].length; columnIndex++) {
			keys.push(inputData[keyRow][columnIndex]);
		}

		return this.structureData(inputData, dataStartRow, keys);
	}

	getColumnWithOffset(startColumn: string, offset: number): string {
		const columnIndex = xlsxUtils.decode_col(startColumn) + offset;
		return xlsxUtils.encode_col(columnIndex);
	}



	async convertStructuredDataToArray(
		inputData: IDataObject[],
		range: string,
		keyRowIndex: number,
		usePathForKeyRow: boolean,
	): Promise<string[][]> {
		let startColumn, endColumn;
		let sheet: string | undefined = undefined;
		if (range.includes('!')) {
			[sheet, range] = range.split('!');
		}
		[startColumn, endColumn] = range.split(':');

		let getRange = `${startColumn}${keyRowIndex + 1}:${endColumn}${keyRowIndex + 1}`;

		if (sheet !== undefined) {
			getRange = `${sheet}!${getRange}`;
		}

		const keyColumnData = await this.getData(getRange, 'UNFORMATTED_VALUE');

		if (keyColumnData === undefined) {
			throw new NodeOperationError(
				this.executeFunctions.getNode(),
				'Could not retrieve the column data!',
			);
		}

		const keyColumnOrder = keyColumnData[0];

		const setData: string[][] = [];

		let rowData: string[] = [];
		inputData.forEach((item) => {
			rowData = [];
			keyColumnOrder.forEach((key) => {
				const value = get(item, key) as string;
				if (usePathForKeyRow && value !== undefined && value !== null) {
					//match by key path
					rowData.push(value!.toString());
				} else if (
					!usePathForKeyRow &&
					item.hasOwnProperty(key) &&
					item[key] !== null &&
					item[key] !== undefined
				) {
					//match by exact key name
					rowData.push(item[key]!.toString());
				} else {
					rowData.push('');
				}
			});
			setData.push(rowData);
		});

		return setData;
	}
}
