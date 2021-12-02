import { restoreAll, spy, spyOn } from 'nanospy';
import { is_sampled, make } from 'tctx';
import { suite, test } from 'uvu';
import * as assert from 'uvu/assert';

import * as rian from '../src/index.js';

const noop = () => {};

test.after.each(() => {
	restoreAll();
});

test('exports', () => {
	assert.type(rian.create, 'function');
});

test('api', async () => {
	const exporter = spy<rian.Exporter>();
	const tracer = rian.create({
		exporter,
	});

	const scope = tracer.span('some-name');

	scope.set_context({
		baz: 'qux',
	});

	scope.measure('test', (scope) => {
		scope.set_context({
			foo: 'bar',
		});

		return 'test';
	});

	scope.end();

	await tracer.end();

	assert.equal(exporter.callCount, 1);
	const items = exporter.calls[0][0] as Set<rian.Span>;
	assert.instance(items, Set);
	assert.equal(items.size, 2);
});

test('context', async () => {
	const exporter = spy<rian.Exporter>();
	const tracer = rian.create({
		exporter,
	});

	const span = tracer.span('context');

	span.set_context({
		one: 'one',
	});

	span.set_context((ctx) => ({ [ctx.one]: 'two' }));

	span.set_context({
		three: 'three',
	});

	span.end();

	await tracer.end();

	const items = exporter.calls[0][0] as Set<rian.Span>;
	assert.instance(items, Set);
	assert.equal(items.size, 1);
	assert.equal(Array.from(items)[0].context, {
		one: 'two',
		three: 'three',
	});
});

test('has start and end times', async () => {
	let called = -1;
	spyOn(Date, 'now', () => ++called);

	let spans: ReadonlySet<rian.Span>;
	const tracer = rian.create({
		exporter: (x) => (spans = x),
	});

	tracer.span('test')((s) => s.fork('test2').end());

	await tracer.end();

	assert.equal(spans.size, 2);
	const arr = Array.from(spans);

	// 2 spans, 2 calls per span
	assert.equal(arr[0].start, 0);
	assert.equal(arr[0].end, 3);
	assert.equal(arr[1].start, 1);
	assert.equal(arr[1].end, 2);
});

test.run();

const fn = suite('fn mode');

fn('api', async () => {
	const exporter = spy<rian.Exporter>();

	const tracer = rian.create({
		exporter,
	});

	tracer.measure('test', spy());
	tracer.span('forked')(spy());

	await tracer.end();

	assert.equal(exporter.callCount, 1);
	const items = exporter.calls[0][0] as Set<rian.Span>;
	assert.instance(items, Set);
	assert.equal(items.size, 2);
});

fn.run();

const measure = suite('measure');

measure('accepts arguments', async () => {
	const tracer = rian.create({
		exporter: spy(),
	});

	const fn = spy<(a: string, b: string) => string>();

	tracer.measure('test', fn, 'arg a', 'arg b');

	await tracer.end();

	assert.equal(fn.callCount, 1);
	const args = fn.calls[0];
	args.pop();
	assert.equal(args, ['arg a', 'arg b']);
});

measure('throw context', async () => {
	const tracer = rian.create({
		exporter: spy(),
	});

	assert.throws(() =>
		tracer.measure('test', () => {
			throw new Error('test');
		}),
	);

	// TODO: Replace with assert.rejects
	try {
		const prom = tracer.measure('test', () => Promise.reject('test'));
		assert.instance(prom, Promise);
		await prom;
		assert.unreachable('promise should throw');
	} catch (e) {
		assert.ok('promise throw');
	}

	tracer.end();
});

measure.run();

const sampled = suite('sampling');

sampled('default :: no parent should be sampled', async () => {
	const exporter = spy<rian.Exporter>();
	const tracer = rian.create({
		exporter,
	});

	tracer.span('test')(noop);

	await tracer.end();

	assert.equal(exporter.callCount, 1);

	const spans: Set<rian.Span> = exporter.calls[0][0];
	assert.equal(spans.size, 1);
	assert.ok(
		Array.from(spans).every((i) => is_sampled(i.id)),
		'every id should be sampled',
	);
});

sampled('default :: should obey parent', async () => {
	const exporter = spy<rian.Exporter>();
	const tracer = rian.create({
		exporter,
		traceparent: String(make(false)),
	});

	tracer.span('test')(noop);

	await tracer.end();

	assert.equal(exporter.callCount, 1);

	const spans: Set<rian.Span> = exporter.calls[0][0];
	assert.equal(spans.size, 1);
	assert.not.ok(
		Array.from(spans).every((i) => is_sampled(i.id)),
		'every id should not be sampled',
	);
});

sampled.run();
