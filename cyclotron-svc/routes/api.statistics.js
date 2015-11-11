/*
 * Copyright (c) 2013-2015 the original author or authors.
 *
 * Licensed under the MIT License (the "License");
 * you may not use this file except in compliance with the License. 
 * You may obtain a copy of the License at
 *
 *     http://www.opensource.org/licenses/mit-license.php
 *
 * Unless required by applicable law or agreed to in writing, 
 * software distributed under the License is distributed on an 
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, 
 * either express or implied. See the License for the specific 
 * language governing permissions and limitations under the License. 
 */ 
 
/* 
 * Cyclotron Statistics
 */

var config = require('../config/config'),
    _ = require('lodash'),
    moment = require('moment'),
    mongoose = require('mongoose'),
    Promise = require('bluebird'),
    api = require('./api');
    
var Analytics = mongoose.model('analytics'),
    Dashboards = mongoose.model('dashboard2'),
    DataSourceAnalytics = mongoose.model('dataSourceAnalytics'),
    Revisions = mongoose.model('revision'),
    Sessions = mongoose.model('session'),
    Users = mongoose.model('user');

var getDashboardCounts = function () {
    return new Promise(function (resolve, reject) {
        Promise.join(
            getDashboardCounts2(null),
            getDashboardCounts2(true),
            getDashboardCounts2(false),
            function (totalDashboardCounts, deletedDashboardCounts, undeletedDashboardCounts) {
                resolve({
                    total: totalDashboardCounts,
                    deletedDashboards: deletedDashboardCounts,
                    undeletedDashboards: undeletedDashboardCounts
                });
            })
        .catch(function (err) {
            console.log(err);
            reject(err);
        });
    });
};

var getDashboardCounts2 = function (isDeleted) {
    return new Promise(function (resolve, reject) {
        var oneDay = moment().subtract(1, 'day'),
            oneMonth = moment().subtract(1, 'month'),
            sixMonths = moment().subtract(6, 'month');

        pipeline = [{
            $project: {
                /* $size is MongoDB 2.6 only -- enable after upgrade
                editorCount: { $size: { $ifNull: ['$editors', []] } },
                viewerCount: { $size: { $ifNull: ['$viewers', []] } },
                tagsCount: { $size: { $ifNull: ['$tags', []] } }
                */
                editedPastDay: { $cond: [ { '$gt': [ '$date', oneDay.toDate() ] }, 1, 0]},
                editedPastMonth: { $cond: [ { '$gt': [ '$date', oneMonth.toDate() ] }, 1, 0]},
                editedPastSixMonths: { $cond: [ { '$gt': [ '$date', sixMonths.toDate() ] }, 1, 0]}
            },
        }, {
            $group: {
                _id: {},
                count: { $sum: 1 },
                editedPastDayCount: { $sum: '$editedPastDay' },
                editedPastMonthCount: { $sum: '$editedPastMonth' },
                editedPastSixMonthsCount: { $sum: '$editedPastSixMonths' }
                /*avgTagsCount: { $avg: '$tagsCount' },
                maxTagsCount: { $max: '$tagsCount' },
                avgEditorCount: { $avg: '$editorCount' },
                avgViewerCount: { $avg: '$viewerCount' },
                unrestrictedEditingCount: { $sum: { $cond: [ { $eq: ['$editorCount', 0] }, 1, 0 ]}},
                unrestrictedViewingCount: { $sum: { $cond: [ { $eq: ['$viewerCount', 0] }, 1, 0 ]}},
                restrictedEditingCount: { $sum: { $cond: [ { $gt: ['$editorCount', 0] }, 1, 0 ]}},
                restrictedViewingCount: { $sum: { $cond: [ { $gt: ['$viewerCount', 0] }, 1, 0 ]}}*/
            }
        }]

        if (!_.isNull(isDeleted)) {
            pipeline.unshift({
                $match: {
                    deleted: isDeleted
                }
            });
        }

        Dashboards.aggregate(pipeline).exec(function (err, results) {
            if (err) {
                return reject(err);
            }

            resolve(_.omit(results[0], '_id'));
        });
    });
};

var getPageViewsCounts = function () {
    return new Promise(function (resolve, reject) {
        Analytics.aggregate([{
            $group: {
                _id: { 'uid': '$uid', 'visitId': '$visitId' },
                totalPageViews: { $sum: 1 },
            }
        }, {
            $group: {
                _id: { 'uid': '$_id.uid' },
                totalPageViews: { $sum: '$totalPageViews'},
                totalVisits: { $sum: 1 }
            }
        }, {
            $group: {
                _id: {},
                totalPageViews: { $sum: '$totalPageViews'},
                totalVisits: { $sum: '$totalVisits'},
                uniqueUids: { $sum: 1 }
            }
        }]).exec(function (err, results) {
            if (err) {
                reject(err);
            }

            results = _.omit(results[0], '_id');
            results.avgPageViewsPerUid = results.totalPageViews / results.uniqueUids;
            results.avgVisitsPerUid = results.totalVisits / results.uniqueUids;
            results.avgPageViewsPerVisit = results.totalPageViews / results.totalVisits;
            resolve(results);
        });
    });
};

var getUserCounts = function () {
    return new Promise(function (resolve, reject) {
        var oneDay = moment().subtract(1, 'day'),
            oneMonth = moment().subtract(1, 'month'),
            sixMonths = moment().subtract(6, 'month');

        Users.aggregate([{
            $match: { name: { $ne: 'Cyclotron' } }
        }, {
            $project: {
                timesLoggedIn: '$timesLoggedIn',
                activePastDay: { $cond: [ { '$gt': [ '$lastLogin', oneDay.toDate() ] }, 1, 0]},
                activePastMonth: { $cond: [ { '$gt': [ '$lastLogin', oneMonth.toDate() ] }, 1, 0]},
                activePastSixMonths: { $cond: [ { '$gt': [ '$lastLogin', sixMonths.toDate() ] }, 1, 0]}
            }
        }, {
            $group: {
                _id: {},
                count: { $sum: 1 },
                activePastDayCount: { $sum: '$activePastDay' },
                activePastMonthCount: { $sum: '$activePastMonth' },
                activePastSixMonthsCount: { $sum: '$activePastSixMonths' },
                avgLoginsPerUser: { $avg: '$timesLoggedIn' }
            }
        }]).exec(function (err, results) {
            if (err) {
                return reject(err);
            }

            resolve(_.omit(results[0], '_id'));
        });
    });
}

/* Aggregates Revisions to determine:
 *   - Number of Revisions
 *   - Average number of Revisions per Dashboards
 */
var getRevisions = function () {
    return new Promise(function (resolve, reject) {
        Revisions.aggregate([{
            $group: {
                _id: { name: '$name' },
                revisionCount: { $sum: 1 }
            }
        }, {
            $group: {
                _id: { },
                dashboardCount: { $sum: 1 },
                count: { $sum: '$revisionCount' },
                avgRevisionCount: { $avg: '$revisionCount' },
                maxRevisionCount: { $max: '$revisionCount' }
            }
        }]).exec(function (err, results) {
            if (err) {
                return reject(err);
            }

            resolve(_.omit(results[0], '_id'));
        });
    });
}

/* Aggregates Revisions to determine:
 *   - Number of Users who have edited a Dashboard
 *   - Average number of Dashboards edited per User
 *   - Average number of Revisions created per User
 */
var getUsersByRevisions = function () {
    return new Promise(function (resolve, reject) {
        Revisions.aggregate([{
            $match: { lastUpdatedBy: { $ne: null }}
        }, {
            $project: {
                name: '$name',
                lastUpdatedBy: '$lastUpdatedBy'
            }
        }, {
            $group: {
                _id: { name: '$name', lastUpdatedBy: '$lastUpdatedBy', },
                revisionCount: { $sum: 1 }
            }
        }, {
            $group: {
                _id: { lastUpdatedBy: '$_id.lastUpdatedBy', },
                dashboardCount: { $sum: 1 },
                revisionCount: { $sum: '$revisionCount' }
            }
        }, {
            $group: {
                _id: { },
                avgDashboardsModifiedByUser: { $avg: '$dashboardCount' },
                avgRevisionsByUser: { $avg: '$revisionCount' },
                editingUserCount: { $sum: 1 }
            }
        }]).exec(function (err, results) {
            if (err) {
                return reject(err);
            }

            resolve(_.omit(results[0], '_id'));
        });
    });
}

var getSessionCounts = function () {
    return new Promise(function (resolve, reject) {
        
        Sessions.find({
            expiration: { $gt: moment().toDate() }
        }).count().exec(function (err, results) {
            if (err) {
                console.log(err);
                return reject(err);
            }

            resolve({ activeSessions: results });
        });
    });
}

/* General Instance statistics */
exports.get = function (req, res) {

    Promise.join(
        getDashboardCounts(), 
        getPageViewsCounts(), 
        getUserCounts(),
        getSessionCounts(),
        getUsersByRevisions(),
        getRevisions(),
        function (dashboardCounts, analyticsCounts, userCounts, sessionCounts, usersByRevisions, revisions) {
            res.send({
                dashboards: dashboardCounts,
                pageViews: analyticsCounts,
                revisions: revisions,
                sessions: sessionCounts,
                users: _.merge(userCounts, usersByRevisions)
            });
        })
    .catch(function (err) {
        console.log(err);
        res.status(500).send(err);
    });
};