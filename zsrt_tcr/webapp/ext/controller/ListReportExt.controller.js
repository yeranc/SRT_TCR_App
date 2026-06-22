sap.ui.define([
    "sap/m/MessageToast",
    "sap/ui/export/Spreadsheet",
    "sap/ui/model/json/JSONModel"
], function (MessageToast, Spreadsheet, JSONModel) {
    "use strict";

    return {
        /*
        /* Method get_results
        /* Fetch process logs for selected TCRs
        */
        get_results: function () {
            const aContexts = this.extensionAPI.getSelectedContexts();

            if (!aContexts || !aContexts.length) {
                MessageToast.show("No rows selected");
                return;
            }

            // Keep only one entry per TCR number in case of multiple selected rows for the same TCR
            const mUnique = {};
            aContexts.forEach(function (oContext) {
                const oData = oContext.getObject();
                mUnique[oData.vtgrrnr] = oData;
            });

            const aSelectedData = Object.values(mUnique);

            // Map TCR number to Processing ID
            const mapTcrToPid = {};
            aSelectedData.forEach(function (o) {
                mapTcrToPid[String(o.vtgrrnr).padStart(20, "0")] = String(o.processingID);
            });

            // Sort by TCR number
            aSelectedData.sort(function (a, b) {
                return Number(a.vtgrrnr) - Number(b.vtgrrnr);
            });

            // Build SourceNumber ranges
            const aRanges = [];
            let nStart = null, nPrev = null;

            aSelectedData.forEach(function (oData) {
                const nCurrent = Number(oData.vtgrrnr);
                if (nStart === null) {
                    nStart = nCurrent;
                    nPrev = nCurrent;
                    return;
                }
                if (nCurrent === nPrev + 1) {
                    nPrev = nCurrent;
                    return;
                }
                aRanges.push({ from: nStart, to: nPrev });
                nStart = nCurrent;
                nPrev = nCurrent;
            });
            if (nStart !== null) {
                aRanges.push({ from: nStart, to: nPrev });
            }

            // Build OData filters on Source TCR Number only
            const aFilters = aRanges.map(function (oRange) {
                const sFrom = String(oRange.from).padStart(20, "0");
                const sTo = String(oRange.to).padStart(20, "0");

                return oRange.from === oRange.to
                    ? new sap.ui.model.Filter("SourceNumber", sap.ui.model.FilterOperator.EQ, sFrom)
                    : new sap.ui.model.Filter("SourceNumber", sap.ui.model.FilterOperator.BT, sFrom, sTo);
            });

            const oFilter = new sap.ui.model.Filter({ filters: aFilters, and: false });

            const oModel = this.getView().getModel();
            oModel.read("/ProcessLog", {
                filters: [oFilter],
                success: function (oData) {
                    const aResults = oData.results || [];

                    // Now keep only rows where ProcessingId matches the paired TCR
                    const aFiltered = aResults.filter(function (oResult) {
                        const sExpectedPid = mapTcrToPid[oResult.SourceNumber];
                        return sExpectedPid !== undefined
                            && String(oResult.ProcessingId) === sExpectedPid;
                    });

                    // Add "not replicated" for TCRs with no log entry
                    aSelectedData.forEach(function (oSelected) {
                        const sPadded = String(oSelected.vtgrrnr).padStart(20, "0");
                        const bFound = aFiltered.some(function (oResult) {
                            return oResult.SourceNumber === sPadded;
                        });

                        if (!bFound) {
                            aFiltered.push({
                                SourceNumber: sPadded,
                                ObjectType: "TCR",
                                Message: "TCR " + oSelected.vtgrrnr + " has not yet been replicated"
                            });
                        }
                    });

                    // Sort by TCR number
                    aFiltered.sort(function (a, b) {
                        return Number(a.SourceNumber) - Number(b.SourceNumber);
                    });

                    this._showResultDialog(aFiltered);

                }.bind(this),
                error: function () {
                    MessageToast.show("Error fetching logs");
                }
            });
        },

        /*
        /* Method _showResultDialog
        /* Display logs in a dialog table
        */
        _showResultDialog: function (aResults) {
            const oJsonModel = new JSONModel({ results: aResults });

            const oTable = new sap.m.Table({
                growing: true,
                growingThreshold: 50,
                columns: [
                    new sap.m.Column({ header: new sap.m.Text({ text: "TCR Number" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Object Type" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Source Object Number" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Process Ref ID" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Target Object Number" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Target System" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Message Type" }) }),
                    new sap.m.Column({ header: new sap.m.Text({ text: "Message" }) })
                ]
            });

            // Bind result data to table
            oTable.setModel(oJsonModel);
            oTable.bindItems({
                path: "/results",
                template: new sap.m.ColumnListItem({
                    cells: [
                        new sap.m.Text({ text: "{SourceNumber}" }),
                        new sap.m.Text({ text: "{ObjectType}" }),
                        new sap.m.Text({ text: "{SourceNumber}" }),
                        new sap.m.Text({ text: "{ProcessingId}" }),
                        new sap.m.Text({ text: "{TargetNumber}" }),
                        new sap.m.Text({ text: "{Systemm}" }),
                        new sap.m.Text({ text: "{Type}" }),
                        new sap.m.Text({ text: "{Message}" })
                    ]
                })
            });

            // Export button
            const oExportButton = new sap.m.Button({
                text: "Export",
                type: "Emphasized",
                press: function () {
                    this._exportToExcel(aResults);
                }.bind(this)
            });

            // Results dialog
            const oDialog = new sap.m.Dialog({
                title: "TCR Copy Logs",
                contentWidth: "90%",
                contentHeight: "80%",
                resizable: true,
                draggable: true,
                content: [oTable],
                buttons: [
                    oExportButton,
                    new sap.m.Button({
                        text: "Close",
                        press: function () {
                            oDialog.close();
                        }
                    })
                ],
                afterClose: function () {
                    oDialog.destroy();
                }
            });

            oDialog.open();
        },

        _exportToExcel: function (aData) {
            if (!aData || !aData.length) {
                MessageToast.show("No records to export");
                return;
            }

            const aCols = [
                { label: "TCR", property: "SourceNumber" },
                { label: "Process ID", property: "ProcessingId" },
                { label: "Object Type", property: "ObjectType" },
                { label: "Source Number", property: "SourceNumber" },
                { label: "Message Type", property: "Type" },
                { label: "Message", property: "Message" },
                { label: "Created TCR", property: "TargetNumber" },
                { label: "System", property: "Systemm" }
            ];

            const oSheet = new Spreadsheet({
                workbook: { columns: aCols },
                dataSource: aData,
                fileName: "TCR_Copy_Log.xlsx"
            });

            oSheet.build()
                .then(function () {
                    MessageToast.show("Excel downloaded successfully");
                })
                .finally(function () {
                    oSheet.destroy();
                });
        }
    };
});