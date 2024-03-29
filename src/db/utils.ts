/* eslint-disable no-underscore-dangle */
import { Knex } from 'knex';
import { Readable, Transform } from 'stream';
import knex from '.';
import { identity } from '../algebra/functions';

export function insertGetIds<T>(query: Knex.QueryBuilder): Promise<T[]> {
	return query.returning('id').then(identity);
}

export type OrderByColumn = {column: string, order: 'asc'|'desc'};

export type OrderByArray = OrderByColumn[];

export async function selectId<T>(query: Knex.QueryBuilder): Promise<T> {
	return query.pluck('id').then(identity).then((ids) => ids[0]);
}

function rowToEntityTransformStream<TEntity>(rowToEntity: (row: any, trx?: Knex.Transaction) => Promise<TEntity>, trx?: Knex.Transaction) {
	return new Transform({
		objectMode: true,
		transform(row, _, done) {
			rowToEntity(row, trx)
				.then((obj) => done(null, obj), done);
		},
	});
}

export function findOneGenerator<TFilter extends Record<string, any> | string | number, TEntity = object>(
	table: string,
	columns: string[],
	rowToEntity: (row: any, trx?: Knex.Transaction) => Promise<TEntity>,
) {
	return async (filter: TFilter, trx?: Knex.Transaction): Promise<TEntity | null> => {
		const query = trx?.queryBuilder() || knex.queryBuilder();
		const row = await query.table(table)
			.where(
				typeof filter === 'object' ? filter : { id: filter },
			)
			.first(columns);
		return row ? rowToEntity(row, trx) : null;
	};
}

function findFirstsQuery<TFilter extends Record<string, any> | string | number>(
	table: string,
	columns: string[],
	filters: TFilter[],
	trx?: Knex.Transaction,
) {
	const query = trx?.queryBuilder() || knex.queryBuilder();
	return filters.reduce<Knex.QueryBuilder>((_query, filter) => _query.unionAll(function findSingle() {
		return this.table(table)
			.where(
				typeof filter === 'object' ? filter : { id: filter },
			)
			.limit(1)
			.select(columns);
	}, true), query);
}

export function findFirstsGenerator<TFilter extends Record<string, any> | string | number, TEntity = object>(
	table: string,
	columns: string[],
	rowToEntity: (row: any, trx?: Knex.Transaction) => Promise<TEntity>,
) {
	return async (filters: TFilter[], trx?: Knex.Transaction): Promise<TEntity[]> => {
		if (filters.length > 0) {
			const rows = await findFirstsQuery(table, columns, filters, trx);
			if (rows.length !== filters.length) {
				throw new Error('unable to find all the rows');
			}
			return Promise.all(rows.map((row: any) => rowToEntity(row, trx)));
		}
		return [];
	};
}

export function findFirstsStreamGenerator<TFilter extends Record<string, any> | string | number, TEntity = object>(
	table: string,
	columns: string[],
	rowToEntity: (row: any, trx?: Knex.Transaction) => Promise<TEntity>,
) {
	return (filters: TFilter[], trx?: Knex.Transaction): Readable => {
		if (filters.length > 0) {
			return findFirstsQuery(table, columns, filters, trx)
				.pipe(rowToEntityTransformStream(rowToEntity, trx));
		}
		return Readable.from([], {
			objectMode: true,
		});
	};
}

function findMultiQuery<TFilter extends Record<string, any> | string | number>(
	table: string,
	columns: string[],
	filters: TFilter[],
	orderBy?: OrderByArray,
	trx?: Knex.Transaction,
) {
	const query = trx?.queryBuilder() || knex.queryBuilder();
	return filters.reduce<Knex.QueryBuilder>((_query, filter) => _query.unionAll(function findSingle() {
		return this.table(table)
			.where(
				typeof filter === 'object' ? filter : { id: filter },
			)
			.select(columns);
	}, true), query).orderBy(orderBy || []);
}

export function findMultiGenerator<TFilter extends Record<string, any> | string | number, TEntity = object>(
	table: string,
	columns: string[],
	rowToEntity: (row: any, trx?: Knex.Transaction) => Promise<TEntity>,
) {
	return async (filters: TFilter[], orderBy?: OrderByArray, trx?: Knex.Transaction): Promise<TEntity[]> => {
		if (filters.length > 0) {
			const rows: any[] = await findMultiQuery(table, columns, filters, orderBy, trx);
			return Promise.all(rows.map((row: any) => rowToEntity(row, trx)));
		}
		return [];
	};
}

export function findMultiStreamGenerator<TFilter extends Record<string, any> | string | number, TEntity = object>(
	table: string,
	columns: string[],
	rowToEntity: (row: any, trx?: Knex.Transaction) => Promise<TEntity>,
) {
	return (filters: TFilter[], orderBy?: OrderByArray, trx?: Knex.Transaction): Readable => {
		if (filters.length > 0) {
			return findMultiQuery(table, columns, filters, orderBy, trx)
				.pipe(rowToEntityTransformStream(rowToEntity, trx));
		}
		return Readable.from([], {
			objectMode: true,
		});
	};
}

export function findGroupedMultiGenerator<TFilter extends Record<string, any> | string | number, TEntity = object>(
	table: string,
	columns: string[],
	rowToEntity: (row: any, trx?: Knex.Transaction) => Promise<TEntity>,
) {
	return async (filters: TFilter[], orderBy?: OrderByArray, trx?: Knex.Transaction): Promise<TEntity[][]> => {
		if (filters.length > 0) {
			const query = trx?.queryBuilder() || knex.queryBuilder();
			const rows: any[] = await filters.reduce<Knex.QueryBuilder>((_query, filter, index) => _query.unionAll(function findSingle() {
				return this.table(table)
					.where(
						typeof filter === 'object' ? filter : { id: filter },
					)
					.select(...columns, knex.raw('? as "_group_"', [index]));
			}, true), query).orderBy(orderBy ?? []);

			const groups = rows.reduce((gs: any[][], row) => {
				const groupIndex = Number(row._group_);
				// eslint-disable-next-line no-param-reassign
				delete row._group_;
				// eslint-disable-next-line no-param-reassign
				gs[groupIndex].push(row);

				return gs;
			}, new Array(filters.length).fill(0).map(() => []));

			return Promise.all(
				groups.map(
					(g) => Promise.all(
						g.map((row) => rowToEntity(row, trx)),
					),
				),
			);
		}
		return [];
	};
}

function findAllQuery<TFilter extends Record<string, any> | string | number>(
	table: string,
	columns: string[],
	filter: TFilter,
	orderBy?: OrderByArray,
	trx?: Knex.Transaction,
) {
	const query = trx?.queryBuilder() || knex.queryBuilder();
	return query.table(table)
		.where(
			typeof filter === 'object' ? filter : { id: filter },
		)
		.orderBy(orderBy ?? [])
		.select(columns);
}

export function findAllGenerator<TFilter extends Record<string, any> | string | number, TEntity = object>(
	table: string,
	columns: string[],
	rowToEntity: (row: any, trx?: Knex.Transaction) => Promise<TEntity>,
) {
	return async (filter: TFilter, orderBy?: OrderByArray, trx?: Knex.Transaction): Promise<TEntity[]> => {
		const rows: any[] = await findAllQuery(table, columns, filter, orderBy, trx);
		return Promise.all(rows.map((row: any) => rowToEntity(row, trx)));
	};
}

export function findAllStreamGenerator<TFilter extends Record<string, any> | string | number, TEntity = object>(
	table: string,
	columns: string[],
	rowToEntity: (row: any, trx?: Knex.Transaction) => Promise<TEntity>,
) {
	return (
		filter: TFilter,
		orderBy?: OrderByArray,
		trx?: Knex.Transaction,
	): Readable => findAllQuery(table, columns, filter, orderBy, trx)
		.pipe(rowToEntityTransformStream(rowToEntity, trx));
}

export function fromQueryGenerator<TEntity = object>(
	columns: string[],
	rowToEntity: (row: any, trx?: Knex.Transaction) => Promise<TEntity>,
) {
	return async (query: Knex.QueryBuilder, trx?: Knex.Transaction): Promise<TEntity[]> => {
		const rows: any[] = await query.select(columns);
		return Promise.all(rows.map((row: any) => rowToEntity(row, trx)));
	};
}

export function fromQueryStreamGenerator<TEntity = object>(
	columns: string[],
	rowToEntity: (row: any, trx?: Knex.Transaction) => Promise<TEntity>,
) {
	return (query: Knex.QueryBuilder, trx?: Knex.Transaction): Readable => query.select(columns)
		.pipe(rowToEntityTransformStream(rowToEntity, trx));
}
