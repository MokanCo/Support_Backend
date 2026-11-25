import assert from 'node:assert/strict';
import {
  ORDER_REPLY,
  classifyUtterance,
  decideReply,
  replyIntroducesFacts,
  selectKnowledge,
  isWithinBusinessHours,
  escapeXml,
} from '../src/services/aiAnswerPolicy.js';

assert.equal(classifyUtterance('I would like to order a latte'), 'order');
assert.equal(classifyUtterance('Can I pay with a credit card?'), 'payment');
assert.equal(classifyUtterance('Can I speak to a manager?'), 'human');
assert.equal(classifyUtterance('This is a complaint about my drink'), 'complaint');
assert.equal(classifyUtterance('What time do you open?'), 'question');

const entries = [
  { _id: 'g1', scope: 'global', title: 'Opening hours', body: 'Most branches open at 8:00.' },
  { _id: 'b1', scope: 'branch', title: 'Opening hours', body: 'This branch opens at 7:30.' },
  { _id: 'g2', scope: 'global', title: 'Delivery', body: 'Delivery is available through our approved partners.' },
];
const chosen = selectKnowledge('what are your opening hours', entries);
assert.equal(chosen._id, 'b1');
const answer = decideReply('what are your opening hours', entries);
assert.equal(answer.text, 'This branch opens at 7:30.');
assert.equal(answer.transfer, false);

const order = decideReply('I would like to order a latte', entries);
assert.equal(order.text, ORDER_REPLY);
assert.equal(order.transfer, true);

const price = decideReply('how much is a latte', [
  { _id: 'p', scope: 'global', title: 'Latte', body: 'A latte is on the espresso menu.' },
]);
assert.equal(price.transfer, true);

assert.equal(replyIntroducesFacts('We open at 9:30.', 'Open 8:00'), false);
assert.equal(replyIntroducesFacts('We open at 8:00.', 'Open 8:00'), true);
assert.equal(escapeXml(`Tom & "Co" <cafe>`), 'Tom &amp; &quot;Co&quot; &lt;cafe&gt;');

const closed = isWithinBusinessHours(
  {
    timezone: 'America/New_York',
    schedule: [{ day: 'thu', closed: true, open: '', close: '' }],
  },
  new Date('2026-11-19T18:00:00Z'),
);
assert.equal(closed.known, true);

console.log('receptionist policy checks passed');
