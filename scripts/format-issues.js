#!/usr/bin/env node

const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));

// Get user login from command line argument or use default
const userLogin = process.argv[2] || 'alex-nazarov';

// Filter issues assigned to the user
const myIssues = data.filter(issue => {
  const assigneeLogin = issue.assignee?.login;
  return assigneeLogin === userLogin;
});

// Filter out closed/done/resolved issues
const openIssues = myIssues.filter(issue => {
  const statusKey = issue.statusType?.key || issue.status?.key || '';
  return statusKey !== 'done' && statusKey !== 'closed' && statusKey !== 'resolved';
});

console.log(`Всего задач в ответе: ${data.length}`);
console.log(`Назначено на ${userLogin}: ${myIssues.length}`);
console.log(`Открытых задач: ${openIssues.length}\n`);

openIssues.forEach(issue => {
  const status = issue.statusType?.display || issue.status?.display || 'Unknown';
  const queue = issue.queue?.key || 'Unknown';
  const assignee = issue.assignee?.login || issue.assignee?.display || 'Не назначен';
  const url = `https://st.yandex-team.ru/${issue.key}`;
  
  console.log(`${issue.key.padEnd(25)} | ${status.padEnd(20)} | ${queue.padEnd(20)} | ${assignee}`);
  console.log(`  ${url}`);
  console.log(`  ${issue.summary}`);
  console.log('');
});
